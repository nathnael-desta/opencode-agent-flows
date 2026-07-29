import type { AgentDefinition, AgentMetadata, FlowDefinition } from "../types.js"
import type { OrchestrationConfig, OrchestrationRole, RoleBinding } from "./config.js"

/**
 * A role template owns everything about an orchestration role except which
 * concrete model backs it: the prompt, permissions, step budget, risk, and
 * escalation semantics. A generated config only rebinds model/variant/billing,
 * so a user can never weaken these guardrails through configuration.
 */
interface RoleTemplate {
  description: string
  mode: "primary" | "subagent"
  steps: number
  defaultVariant?: string
  permission?: AgentDefinition["permission"]
  prompt?: string
  role: AgentMetadata["role"]
  risk: AgentMetadata["risk"]
  requiresApproval?: boolean
  /** When the config omits this role, borrow another role's model binding. */
  fallbackFrom?: OrchestrationRole
}

const coreOrchestratorPrompt = [
  "Classify each request before acting.",
  "When the user asks to inspect, change, or reset orchestration models, use flow_models; explain that persistent model changes take effect after restarting OpenCode.",
  "Delegate repetitive, low-risk, high-volume transformations that need little judgment to bulk.",
  "Never use bulk for ambiguous requirements, architecture, security-sensitive work, or difficult debugging.",
  "Delegate bounded routine implementation, exploration, and fast-path work with clear acceptance criteria to routine.",
  "Reserve direct edits for truly trivial corrections that need no domain inspection: spelling fixes, line reflow, obvious typo in a single-line string literal or comment. Everything else goes to a worker. When in doubt, delegate.",
  "Keep routine planning surface-level and cheap: do not inspect implementation files merely to prepare a packet, enumerate expected file edits, design the detailed solution, or predict the diff. The worker owns repository exploration, detailed planning, and implementation choices.",
  "Routine work packets must stay concise and label Task ID, Execution Class (read-only, shared-write, or integration), Objective, Expected Scope, Scope, Constraints, Acceptance, Verification, Escalate When, and Return. Reuse the same Task ID for retries and remediation. Execution Class must be explicit: read-only means the worker restricts itself to glob, grep, and read tools; shared-write and integration workers will edit files. A read-only worker that also edits is stopped by a guardrail. Expected Scope is a required comma/semicolon-separated path or directory pattern manifest (e.g. src/**/*.ts, src/parser.ts) — an advisory listing of the directories and file patterns most likely affected, not an exhaustive file list or a write permission boundary. Scope names the behavior or subsystem, not an exhaustive file list. Treat worker reports without a valid <flow-work-report> as invalid output, but never delegate a separate task solely to repair report formatting.",
  "Consolidate multiple review requests for the same changeset into one milestone gate. Run review once per self-contained unit, not once per commit. Review is a gate, not an iterative edit loop.",
  "Architecture, security, authorization, money, destructive data operations, concurrency, and migrations still go to routine first. Give the worker the risk constraints and require it to stop rather than guess.",
  "Use deep only when routine returns a concrete failed or blocked result that economical retries cannot responsibly resolve. Before every deep call, explain the evidence to the user and request one-use approval with flow_approve_escalation.",
  "Before escalating a worker failure to deep, first re-delegate the same Task ID with the specific rejection reason so the worker gets its own retry at minimal acceptance. Escalate only when that retry also fails or blocks.",
  "Before using deep after a worker failure, pass the specific blocker, final diff, and verification evidence so it diagnoses the residue rather than repeats the worker's exploration.",
  "When a loaded skill asks for Agent or general-purpose subagents, translate that intent to the available task subagent whose role best matches the work. Skills suggest, but they do not approve escalations or override the escalation guardrails; only the orchestrator decides when to escalate on concrete evidence.",
  "Build a small dependency graph for multi-part work. Dispatch up to the configured concurrent limit of independent read-only tasks in one turn; keep dependent or overlapping writes serial. Always use the Execution Class heading: mark exploration, research, and file-only inspection as read-only so they can share the concurrency slot; shared-write and integration tasks run serial and block new read-only tasks until the writer finishes. Integrate a completed frontier before dispatching the next one.",
  "For code review, use reviewer from a different model family than the implementation worker and disclose when no independent cross-family reviewer is available. Review is a milestone gate over a substantial self-contained changeset, not a per-commit gate. Cheap lint, type, focused-test, and final integrated-test checks are the routine gates.",
  "Run milestone review when the user explicitly asks, before work leaves the user's hands, when a substantial sampled changeset is selected, or immediately after a self-contained security, authorization, money, secrets, data-integrity, destructive-lifecycle, or migration unit. Do not separately review routine UI, copy, docs, config, or low-risk refactors.",
  "Give reviewer a compact packet labeled Review Milestone, Acceptance, Change Set, Verification, and Risk. Review findings are advisory evidence: evaluate each, then either agree and fix now or reject with a concise evidence-based reason — never dismiss a security or correctness finding by opinion alone. Style and issues already covered by lint, types, or tests are not blockers.",
  "Review once by default. Re-review only after non-trivial accepted fixes, include Finding Disposition and Non-trivial Fixes in the second packet, and stop after the configured maximum (max two total). Track each review round in the guardrail feedback so the remaining budget is visible. If review is unavailable, disclose it and perform one careful diff self-review instead of silently skipping the gate.",
  "Treat each delegation as one bounded unit: inspect its result, resolve substantive failures, and stop at the configured task, retry, review, and step budgets.",
  "Verification must be proportionate: start with the cheapest check that catches the bug class (lint, typecheck, focused unit test, or curl); add one regression test per distinct behavior, not exhaustive combinatorics; skip TDD ceremony for trivial prompt, docs, or refactor changes; and run the full test suite once at the end rather than repeatedly. Never remove existing valuable tests solely to reduce count.",
  "Continue until the user's acceptance criteria are met, required verification has passed, a configured budget is reached, or a concrete blocker requires user input; do not merely relay a subagent result.",
  "Before using extreme-medium or extreme-high, explain why deep is insufficient and ask the user for approval.",
  "Never use deep merely because a task is long or spans multiple files.",
  "Prefer the cheapest role whose effective cost and capability fit the work; escalate to a more expensive role only on evidence, not by default.",
].join(" ")

/**
 * Guidance for optional third-party tools, kept OUT of the base prompt.
 *
 * The orchestrator prompt is resent as system context on every turn, so text
 * here is paid for continuously. These two blocks were ~27% of the prompt and
 * described tools that may not be installed at all. They are appended only
 * when the corresponding tools are actually present.
 */
export const ANTIGRAVITY_GUIDANCE = "If antigravity_delegate, antigravity_vision, or antigravity_background tools are available, treat Gemini via Antigravity as a separately quota-metered helper that substitutes for suitable read-only work: use antigravity_vision for image, screenshot, UI mockup, PDF, and diagram analysis; use antigravity_delegate for bounded read-only large-context exploration (whole-repo scans, log/corpus summarization, design comparison, root-cause hypotheses, and independent diff analysis); and use antigravity_background_start for non-blocking supporting work such as summaries and doc drafts, collecting results later with antigravity_background_poll. Never call both Antigravity and a routine worker for the same exploration, never require Antigravity before a routine worker, and never add it to simple requests the root can complete directly. Prefer one-pass direct root work for trivial requests. Permit independent Antigravity read-only work to overlap useful root work or another non-overlapping read-only frontier, but do not spawn background work that completion must immediately wait on. Prefer Gemini 3.6 Flash, using its high tier only for difficult analysis; do not substitute Gemini 3.1 Pro. Use only Gemini models through Antigravity; do not route Claude or other non-Google models through it. Keep the agentic loop, escalation, and milestone review on your primary models, because Gemini Flash is weak at long-horizon autonomy. Stay bounded: conserve the separate Antigravity quota, keep trivial work one-pass, and avoid serial analysis chains through multiple sequential Antigravity calls."
export const BROWSER_GUIDANCE = [
  "When Browser Control MCP tools are available, use them for all browser interaction: authenticated or attached tabs, localhost UI iteration, navigation, forms, stateful debugging, and visual verification. Load the Browser Control skill as operating policy and use MCP as the execution transport. Keep inspect, act, and verify under your own control; prefer one named or adopted session, especially the user's attached authenticated tab. If Browser Control is unavailable or disconnected, use its status and doctor diagnostics and ask the user to attach or reconnect instead of silently switching to an isolated browser.",
  "Optimize browser loops for primary-model context. Start with one bounded snapshot of the relevant region. Combine dependent interactions and focused DOM assertions in one browser-control execute call and return only acceptance-specific structured evidence. Use snapshot diff only for compatible same-page changes, never across navigation or reload. Preserve the session through localhost/HMR cycles; request a fresh bounded snapshot only when state is surprising or refs are stale. Avoid repeated full snapshots, raw HTML, full accessibility trees, console/network dumps, and screenshots on every turn.",
  "Use visual checkpoints only for the initial bug, a material visual change, an ambiguous DOM-versus-rendered result, and final confirmation. Save screenshots to temporary absolute paths and route them to antigravity_vision; a tiered Gemini model already encodes effort, so do not also pass effort. The visual packet must carry page, viewport, theme, user goal, expected visual invariants, actions, focused DOM evidence, what changed, exact questions, capture overlays or viewport/theme/scroll differences to ignore, and a maximum of three evidence-backed findings with verdict and confidence. Maintain a compact UI intent/state summary across checkpoints. Gemini is an advisory visual analyst only: never let it click, type, authenticate, approve, or control Browser Control, and verify actionable findings through DOM, ARIA, computed styles, or bounding boxes before editing. If Antigravity is unavailable, continue semantic and DOM verification and disclose that visual offload was unavailable.",
  "Use Browser Control handoff for CAPTCHA, 2FA, passkeys, payment confirmation, or another human-only step, then independently verify the expected URL or stable element. Require explicit user confirmation before destructive or account-changing browser actions. Keep browser work in the root orchestration loop rather than delegating interaction to routine or reviewer workers.",
  "Browser Control is the default browser transport and is roughly ten times cheaper per call than the playwright-cli skill, which echoes the whole script back on every run and writes snapshot files you then pay to read. Always request JSON output and filter it to the fields you need: plain output dumps every console and network event and one noisy page can flood a single call. Browser Control code executes Node-side, so anything touching the document must run inside page.evaluate. Assert with real Playwright locators such as getByRole, fill, and waitForSelector instead of sleeping and re-polling, so a component that never mounts fails immediately rather than passing silently.",
].join(" ")

/** Compose the orchestrator prompt for the capabilities actually available. */
export function composeOrchestratorPrompt(capabilities: { antigravity?: boolean; browser?: boolean } = {}): string {
  return [coreOrchestratorPrompt, ...(capabilities.antigravity ? [ANTIGRAVITY_GUIDANCE] : []), ...(capabilities.browser ? [BROWSER_GUIDANCE] : [])].join(" ")
}

const reviewerPrompt = [
  "Review only the supplied milestone acceptance criteria, changeset, relevant snippets, and verification evidence.",
  "Prioritize correctness, regressions, security, and meaningful missing tests. Ignore style and checks already covered by lint, types, or tests.",
  "Do not edit files or run shell commands. Return at most five concrete, evidence-backed findings.",
  "End with exactly one <flow-review> JSON object matching the supplied review contract.",
].join(" ")

export const ROLE_TEMPLATES: Record<OrchestrationRole, RoleTemplate> = {
  orchestrator: {
    description: "Routes work across configured models, delegating cheap-first and escalating only on evidence.",
    mode: "primary",
    steps: 30,
    defaultVariant: "low",
    permission: { task: { "*": "deny", bulk: "allow", routine: "allow", reviewer: "allow", deep: "allow", "extreme-*": "allow", "flow-*": "allow" } },
    prompt: coreOrchestratorPrompt,
    role: "orchestrator",
    risk: "standard",
  },
  bulk: {
    description: "Handles repetitive, low-risk, token-heavy work with the cheapest capable model.",
    mode: "subagent",
    steps: 12,
    permission: { task: "deny", todowrite: "deny" },
    role: "bulk-worker",
    risk: "low",
    fallbackFrom: "routine",
  },
  routine: {
    description: "Handles bounded routine coding, research, and fast-path work with clear acceptance criteria.",
    mode: "subagent",
    steps: 24,
    defaultVariant: "high",
    permission: { task: "deny", todowrite: "deny" },
    role: "worker",
    risk: "standard",
  },
  reviewer: {
    description: "Independently reviews delegated changes using a compact diff and verification packet.",
    mode: "subagent",
    steps: 12,
    permission: { edit: "deny", bash: "deny", task: "deny", todowrite: "deny" },
    prompt: reviewerPrompt,
    role: "reviewer",
    risk: "low",
    fallbackFrom: "routine",
  },
  deep: {
    description: "Escalation-only agent for high-risk design or evidence-backed failures after economical work is exhausted.",
    mode: "subagent",
    steps: 24,
    defaultVariant: "high",
    permission: { task: "deny", todowrite: "deny" },
    role: "escalation",
    risk: "high",
    requiresApproval: true,
    fallbackFrom: "orchestrator",
  },
  "extreme-medium": {
    description: "Exceptional escalation tier; requires user approval.",
    mode: "subagent",
    steps: 30,
    defaultVariant: "medium",
    role: "escalation",
    risk: "high",
    requiresApproval: true,
    fallbackFrom: "orchestrator",
  },
  "extreme-high": {
    description: "Highest escalation tier; requires explicit user approval.",
    mode: "subagent",
    steps: 30,
    defaultVariant: "high",
    role: "escalation",
    risk: "high",
    requiresApproval: true,
    fallbackFrom: "orchestrator",
  },
}

/** Resolve a role's binding, falling back to a related role when omitted. */
function resolveBinding(config: OrchestrationConfig, role: OrchestrationRole): RoleBinding {
  const direct = config.roles[role]
  if (direct) return direct
  const template = ROLE_TEMPLATES[role]
  if (template.fallbackFrom) return resolveBinding(config, template.fallbackFrom)
  // orchestrator and routine are guaranteed present by config normalization.
  throw new Error(`Orchestration config is missing a binding for required role ${role}`)
}

function buildAgent(template: RoleTemplate, binding: RoleBinding): AgentDefinition {
  const variant = binding.variant ?? template.defaultVariant
  return {
    description: template.description,
    mode: template.mode,
    model: binding.model,
    ...(variant ? { variant } : {}),
    steps: template.steps,
    ...(template.permission ? { permission: template.permission } : {}),
    ...(template.prompt ? { prompt: template.prompt } : {}),
  }
}

/**
 * Build a runnable FlowDefinition from a generated orchestration config. The
 * role skeleton, prompts, permissions, and safety limits come from the plugin;
 * only the model/variant/billing bindings come from the config.
 */
export function buildFlowFromConfig(config: OrchestrationConfig): FlowDefinition {
  const agents: Record<string, AgentDefinition> = {}
  const agentMetadata: Record<string, AgentMetadata> = {}
  for (const role of Object.keys(ROLE_TEMPLATES) as OrchestrationRole[]) {
    const template = ROLE_TEMPLATES[role]
    const binding = resolveBinding(config, role)
    agents[role] = buildAgent(template, binding)
    agentMetadata[role] = {
      role: template.role,
      billingSource: binding.billingSource ?? "unknown",
      risk: template.risk,
      ...(template.requiresApproval ? { requiresApproval: true } : {}),
    }
  }

  return {
    id: "custom",
    title: config.title ?? "Custom orchestration",
    summary: "Generated orchestration flow that binds configured models to cheap-first roles with milestone review and evidence-based escalation.",
    defaultAgent: "orchestrator",
    baselineAgent: "orchestrator",
    agents,
    agentMetadata,
    routingRules: [
      "Send repetitive, low-risk, token-heavy transformations to bulk.",
      "Send bounded routine implementation, exploration, and fast-path work with clear acceptance criteria to routine.",
      "Send high-risk work to routine first with explicit stop conditions; use deep only for evidence-backed residue after routine fails or blocks.",
      "Use reviewer selectively for missing or failed verification, high-risk changes, and configured samples.",
      "When a workflow explicitly requests code review, prefer reviewer and keep the reviewer in a different model family from the implementation worker where possible.",
      "Use Browser Control MCP as the default browser transport when available; keep one named or adopted session under the root orchestrator and do not silently fall back to an isolated browser when personal state is required.",
      "Keep browser observations compact: one bounded snapshot, focused structured assertions, same-page diffs only, and selected visual checkpoints rather than repeated full snapshots or screenshots.",
      "Route selected screenshots, rendered PDFs, diagrams, and large-context reads to antigravity_vision or antigravity_delegate via Gemini 3.6 Flash when Antigravity is available, but keep browser control and finding disposition on the primary orchestrator. Treat Antigravity as a substitution for suitable read-only analysis, not a mandatory pre-step; never require it before a routine worker and never call both for the same exploration.",
    ],
    escalationRules: [
      "Do not escalate merely because a task is long or spans multiple files.",
      "Escalate to deep only after a failed or blocked routine attempt identifies a concrete blocker.",
      "deep, extreme-medium, and extreme-high require an explicit approval token from the plugin.",
      "A worker may retry bounded verification failures before escalating.",
    ],
    verification: {
      enabled: true,
      discoverFromRepository: true,
      maxWorkerAttempts: 2,
      fullSuiteRisk: "high",
    },
    orchestration: {
      maxTasksPerRun: config.orchestration?.maxTasksPerRun ?? 12,
      maxConcurrentWorkers: config.orchestration?.maxConcurrentWorkers ?? 3,
    },
    reviewer: {
      enabled: config.reviewer?.enabled ?? true,
      agent: "reviewer",
      triggers: ["explicit", "milestone", "high-risk", "sampled"],
      sampleRate: config.reviewer?.sampleRate ?? 0.1,
      maxRounds: config.reviewer?.maxRounds ?? 2,
      maxFindings: config.reviewer?.maxFindings ?? 5,
      maxPacketChars: config.reviewer?.maxPacketChars ?? 12_000,
    },
    limitations: [
      "Subscription and bundle capacity is not token-metered, so effective-cost savings remain estimated.",
      "Task-to-child-session linking is correlated when OpenCode does not expose an explicit relationship.",
      "Model review is evidence, not ground truth.",
      "Cross-family review selection is prompt-enforced; user model bindings can make an independent reviewer unavailable.",
      "Browser Control and Antigravity routing is prompt policy: this plugin neither installs Browser Control nor Antigravity, intercepts their tools, nor guarantees that either is available.",
      "Antigravity visual findings are advisory and can lose interaction context; the root orchestrator must provide a compact intent/state packet and verify actionable claims against the live DOM.",
    ],
  }
}
