import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { flows } from "./src/flows/index.js"
import {
  BILLING_SOURCES,
  loadOrchestrationConfig,
  normalizeOrchestrationConfig,
  ORCHESTRATION_CONFIG_VERSION,
  ORCHESTRATION_ROLES,
  saveOrchestrationConfig,
  type OrchestrationConfig,
  type OrchestrationRole,
} from "./src/orchestration/config.js"
import { buildFlowFromConfig } from "./src/orchestration/roles.js"
import { discoverCatalog } from "./src/orchestration/catalog.js"
import { normalizeProviders } from "./src/orchestration/discovery.js"
import { formatDiscovery, formatOrchestrationConfig } from "./src/orchestration/present.js"
import { CONFIG_COMMAND_TEMPLATE, SETUP_COMMAND_TEMPLATE } from "./src/orchestration/setup-prompt.js"
import { detectAntigravity, formatAntigravityStatus, type ProbeRunner } from "./src/orchestration/antigravity.js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentDefinition, AgentMetadata, ExecutionClass, FlowDefinition, OpenCodeConfig, PluginOptions } from "./src/types.js"
import { expandPath, defaultTelemetryDirectory } from "./src/telemetry/path.js"
import { normalizePricing } from "./src/telemetry/pricing.js"
import { commandCodeBudget, readCodexQuota } from "./src/telemetry/quota.js"
import { buildFlowReport } from "./src/telemetry/reports.js"
import { TelemetryStore } from "./src/telemetry/store.js"
import type { DeveloperModeSnapshot, QualityEvidence, ReviewReport, TaskTrace, VerificationEvidence, WorkReport, AntigravityTrace } from "./src/telemetry/types.js"
import { flowReportMarkdown, globalReportMarkdown } from "./src/telemetry/markdown.js"

interface RunState {
  id: string
  rootSessionID: string
  startedAt: number
}
interface SessionInfo {
  id: string
  parentID?: string
}
interface RawMessage {
  id?: string
  role: "user" | "assistant"
  agent?: string
  providerID?: string
  modelID?: string
  variant?: string
  cost?: number
  tokens?: Record<string, number>
  error?: unknown
  time?: { created?: number; completed?: number }
}
type ModelOverrides = Record<string, { model: string; variant?: string }>

const DEFAULT_PROTECTED_PATHS = [".env", "auth", "billing", "infrastructure", "migrations"]
const WORK_PACKET_HEADINGS = ["Objective", "Execution Class", "Expected Scope", "Scope", "Constraints", "Acceptance", "Verification", "Escalate When", "Return"]
const DEEP_PACKET_HEADINGS = [...WORK_PACKET_HEADINGS, "Escalation Evidence"]
const MAX_WORK_PACKET_CHARS = 3_000
const REVIEW_PACKET_HEADINGS = ["Review Milestone", "Acceptance", "Change Set", "Verification", "Risk"]
const WORK_REPORT_CONTRACT = `\n\n## Worker Execution Contract\nInspect the repository before editing. Treat the packet's file and implementation assumptions as hypotheses: correct them when repository evidence requires it, but do not silently broaden the behavioral scope. Stop and report a blocker when the requirements conflict, the scope must expand, or safe verification is unavailable. End with exactly one <flow-work-report> JSON object: {"status":"completed|blocked","summary":"...","filesChanged":["..."],"verification":[{"command":"...","status":"passed|failed|not-run"}],"scopeChanges":["..."],"blocker":"optional"}. Report formatting is not a separate task: if the marker cannot be produced, return the substantive result once and stop.`
const REVIEW_REPORT_CONTRACT = `\n\n## Review Execution Contract\nThis is milestone review round {CURRENT_ROUND} of {MAX_ROUNDS}. This is a milestone gate, not a per-commit review. Review only correctness, security, behavioral regressions, acceptance coverage, and meaningful missing tests. Do not report style or issues already enforced by lint, types, or tests. Return no more than {MAX_FINDINGS} findings. Every finding needs severity, concrete evidence, and an actionable verification. Findings are advisory evidence: the implementing worker or orchestrator must evaluate each and may reject it with a concise evidence-based reason, but security and correctness findings must not be dismissed by opinion alone. End with exactly one <flow-review> JSON object: {"verdict":"pass|changes-requested|blocked","summary":"...","findings":[{"severity":"critical|high|medium|low","title":"...","evidence":"...","file":"optional","line":1,"verification":"optional"}]}.`

function deterministicSample(value: string, rate: number): boolean {
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) / 0xffffffff < Math.max(0, Math.min(1, rate))
}

function normalizeMessage(message: RawMessage) {
  const tokens = message.tokens
  return {
    id: message.id,
    role: message.role,
    agent: message.agent,
    providerID: message.providerID,
    modelID: message.modelID,
    variant: message.variant,
    costUsd: message.cost,
    tokens: tokens
      ? {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          reasoning: tokens.reasoning ?? 0,
          cacheRead: tokens.cacheRead ?? tokens.cache_read ?? 0,
          cacheWrite: tokens.cacheWrite ?? tokens.cache_write ?? 0,
        }
      : undefined,
    createdAt: message.time?.created,
    completedAt: message.time?.completed,
    error: message.error !== undefined,
  }
}

function errorText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return undefined
  const error = value as { message?: unknown; data?: { message?: unknown }; name?: unknown }
  const message = typeof error.data?.message === "string" ? error.data.message : typeof error.message === "string" ? error.message : undefined
  const name = typeof error.name === "string" ? error.name : undefined
  return [name, message].filter(Boolean).join(": ") || JSON.stringify(value)
}

function verificationCategory(command: string): VerificationEvidence["category"] | undefined {
  const value = command.toLowerCase()
  if (/\b(test|vitest|jest|pytest|bun test)\b/.test(value)) return "test"
  if (/\b(typecheck|tsc|mypy|pyright|check-types)\b/.test(value)) return "typecheck"
  if (/\b(lint|eslint|ruff|clippy)\b/.test(value)) return "lint"
  if (/\b(build|compile|cargo check)\b/.test(value)) return "build"
  if (/\bcurl\b|\bwget\b/.test(value)) return "http"
  return undefined
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringValues)
  return []
}

function pathProtected(value: unknown, patterns: string[]): string | undefined {
  const values = stringValues(value).map((item) => item.replaceAll("\\", "/").toLowerCase())
  return patterns.find((pattern) => {
    const literal = pattern.toLowerCase().replaceAll("**/", "").replaceAll("/**", "").replaceAll("*", "")
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const suffix = literal === ".env" ? "(?:\\.[a-z0-9_-]+)?" : ""
    const matcher = new RegExp(`(?:^|[/\\s'\"=])${escaped}${suffix}(?=$|[/\\s'\".,:;])`, "i")
    return values.some((item) => matcher.test(item))
  })
}

function missingPacketHeadings(description: string, headings: string[]): string[] {
  return headings.filter((heading) => !new RegExp(`(?:^|\\n)\\s{0,3}(?:#+\\s*)?(?:\\*\\*)?${heading}(?:\\*\\*)?\\s*:?(?:\\s*\\n|\\s+\\S)`, "im").test(description))
}

function tolerantJson(raw: string): unknown {
  let sanitized = raw
    .replace(/^```(?:json|JAVASCRIPT|javascript)?\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "")
  sanitized = sanitizeTrailingCommas(sanitized)
  return JSON.parse(sanitized)
}

/**
 * Try to extract the single unambiguous JSON object from output when wrapper
 * tags are missing. Returns the inner JSON text (without code fences) on
 * success, or undefined when zero or multiple candidates exist.
 */
function extractUntaggedJson(output: string, requiredKeys: string[]): string | undefined {
  let fenced = output
  const fenceMatch = output.match(/```(?:json|JAVASCRIPT|javascript|JSON)?\s*\n([\s\S]*?)\n\s*```/)
  if (fenceMatch) fenced = fenceMatch[1]
  const objects: { text: string; start: number }[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < fenced.length; i++) {
    const ch = fenced[i]
    if (escape) { escape = false; continue }
    if (ch === "\\" && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        objects.push({ text: fenced.slice(start, i + 1), start })
      }
    }
  }
  const matching = objects.filter((candidate) => {
    try {
      const sanitized = sanitizeTrailingCommas(candidate.text)
      const value = JSON.parse(sanitized)
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false
      return requiredKeys.every((key) => key in value)
    } catch {
      return false
    }
  })
  return matching.length === 1 ? matching[0].text : undefined
}

function sanitizeTrailingCommas(text: string): string {
  let result = ""
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    result += ch
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\" && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
    }
    if (!inString && ch === ",") {
      const rest = text.slice(i + 1)
      const close = rest.match(/^\s*([}\]])/)
      if (close) {
        result = result.slice(0, -1) + close[1]
        i += close[0].length
        continue
      }
    }
  }
  return result
}

function parseWorkReport(output: string): {
  report?: WorkReport
  error?: string
} {
  let jsonText: string | undefined
  const match = output.match(/<flow-work-report>\s*([\s\S]*?)\s*<\/flow-work-report>/)
  if (match) {
    jsonText = match[1]
  } else {
    const untagged = extractUntaggedJson(output, ["status", "summary", "filesChanged", "verification"])
    if (untagged) jsonText = untagged
  }
  if (!jsonText) return { error: "missing <flow-work-report>" }
  try {
    const value = tolerantJson(jsonText) as Partial<WorkReport>
    const validStatus = value.status === "completed" || value.status === "blocked"
    const validFiles = Array.isArray(value.filesChanged) && value.filesChanged.every((item) => typeof item === "string")
    const validScope = Array.isArray(value.scopeChanges) && value.scopeChanges.every((item) => typeof item === "string")
    const validVerification =
      Array.isArray(value.verification) &&
      value.verification.every(
        (item) => typeof item === "object" && item !== null && typeof item.command === "string" && (item.status === "passed" || item.status === "failed" || item.status === "not-run"),
      )
    if (!validStatus || typeof value.summary !== "string" || !validFiles || !validScope || !validVerification || (value.blocker !== undefined && typeof value.blocker !== "string"))
      return { error: "invalid <flow-work-report> schema" }
    const files = value.filesChanged as string[]
    const verification = value.verification as WorkReport["verification"]
    if (files.length === 0 && verification.length === 0)
      return { error: "<flow-work-report> requires filesChanged or verification evidence" }
    return {
      report: {
        status: value.status as WorkReport["status"],
        summary: value.summary,
        filesChanged: files,
        verification,
        scopeChanges: value.scopeChanges as string[],
        blocker: value.blocker,
      },
    }
  } catch {
    return { error: "malformed JSON in <flow-work-report> (check for trailing commas, unquoted strings, or missing braces)" }
  }
}

function parseReviewReport(output: string, maximumFindings: number): { report?: ReviewReport; error?: string } {
  let jsonText: string | undefined
  const match = output.match(/<flow-review>\s*([\s\S]*?)\s*<\/flow-review>/)
  if (match) {
    jsonText = match[1]
  } else {
    const untagged = extractUntaggedJson(output, ["verdict", "summary", "findings"])
    if (untagged) jsonText = untagged
  }
  if (!jsonText) return { error: "missing <flow-review>" }
  try {
    const value = tolerantJson(jsonText) as Partial<ReviewReport>
    const validVerdict = value.verdict === "pass" || value.verdict === "changes-requested" || value.verdict === "blocked"
    const findings = value.findings
    const validFindings =
      Array.isArray(findings) &&
      findings.length <= maximumFindings &&
      findings.every((finding) => {
        if (typeof finding !== "object" || finding === null) return false
        return (
          ["critical", "high", "medium", "low"].includes(finding.severity) &&
          typeof finding.title === "string" &&
          typeof finding.evidence === "string" &&
          (finding.file === undefined || typeof finding.file === "string") &&
          (finding.line === undefined || (Number.isInteger(finding.line) && finding.line > 0)) &&
          (finding.verification === undefined || typeof finding.verification === "string")
        )
      })
    if (!validVerdict || typeof value.summary !== "string" || !validFindings) return { error: "invalid <flow-review> schema" }
    if (value.verdict === "pass" && findings!.length > 0) return { error: "passing <flow-review> cannot contain findings" }
    if (value.verdict !== "pass" && findings!.length === 0) return { error: "non-passing <flow-review> requires findings" }
    return { report: value as ReviewReport }
  } catch {
    return { error: "malformed JSON in <flow-review> (check for trailing commas, unquoted strings, or missing braces)" }
  }
}

function packetField(description: string, heading: string): string | undefined {
  const match = description.match(new RegExp(`(?:^|\\n)\\s{0,3}(?:#+\\s*)?(?:\\*\\*)?${heading}(?:\\*\\*)?\\s*:?\\s*([^\\n]+)`, "i"))
  return match?.[1]?.trim()
}

function parseExecutionClass(description: string): ExecutionClass | undefined {
  const value = packetField(description, "Execution Class")
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower.includes("read-only") || lower.includes("read only") || lower === "readonly") return "read-only"
  if (lower.includes("shared-write") || lower.includes("shared write")) return "shared-write"
  if (lower.includes("integration")) return "integration"
  return undefined
}

function parseExpectedScope(description: string): string[] | undefined {
  const field = packetField(description, "Expected Scope")
  if (!field) return undefined
  return field
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function stableTaskID(description: string): string {
  const explicit = packetField(description, "Task ID")
  if (explicit)
    return explicit
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 100)
  const objective = packetField(description, "Objective") ?? description.split("## Worker Execution Contract", 1)[0]
  const normalized = objective
    .toLowerCase()
    .replace(/\b(return|fix|correct)\s+(the\s+)?(json|xml|work\s+report|report\s+schema|report\s+format)\b/g, "report-output")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  let hash = 2166136261
  for (const character of normalized) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `task-${(hash >>> 0).toString(16)}`
}

function uniqueByID<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function parseEvaluation(output: string, runID?: string, sessionID?: string): QualityEvidence | undefined {
  const match = output.match(/<flow-evaluation>\s*([\s\S]*?)\s*<\/flow-evaluation>/)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[1]) as {
      source?: QualityEvidence["source"]
      verdict?: QualityEvidence["verdict"]
      score?: number
      note?: string
    }
    if (
      !value.source ||
      !value.verdict ||
      !["cheap-review", "audit-review", "shadow-plan", "shadow-implementation"].includes(value.source) ||
      !["good", "mixed", "bad", "unknown"].includes(value.verdict)
    )
      return undefined
    return {
      id: crypto.randomUUID(),
      runID,
      sessionID,
      source: value.source,
      verdict: value.verdict,
      score: value.score,
      note: value.note?.slice(0, 2_000),
      observedAt: Date.now(),
    }
  } catch {
    return undefined
  }
}

function developerDefaults(options: PluginOptions): DeveloperModeSnapshot {
  const developer = options.developer ?? {}
  return {
    enabled: developer.enabled === true,
    auditReview: developer.auditReview === true,
    shadowPlanning: developer.shadowPlanning === true,
    shadowImplementation: developer.shadowImplementation === true,
    sampleRate: developer.sampleRate ?? 0.1,
  }
}

async function loadDeveloperMode(path: string, defaults: DeveloperModeSnapshot): Promise<DeveloperModeSnapshot> {
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as Partial<DeveloperModeSnapshot>
    return {
      ...defaults,
      ...saved,
      sampleRate: Math.max(0, Math.min(1, saved.sampleRate ?? defaults.sampleRate)),
    }
  } catch {
    return defaults
  }
}

async function saveDeveloperMode(path: string, state: DeveloperModeSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}

async function loadModelOverrides(path: string): Promise<ModelOverrides> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(value).flatMap(([agent, override]) => {
        if (typeof override !== "object" || override === null || typeof (override as { model?: unknown }).model !== "string") return []
        const { model, variant } = override as {
          model: string
          variant?: unknown
        }
        return [[agent, { model, ...(typeof variant === "string" ? { variant } : {}) }]]
      }),
    )
  } catch {
    return {}
  }
}

async function saveModelOverrides(path: string, state: ModelOverrides): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}

function applyModelOverrides(agents: Record<string, AgentDefinition>, overrides: ModelOverrides): Record<string, AgentDefinition> {
  return Object.fromEntries(
    Object.entries(agents).map(([name, definition]) => {
      const override = overrides[name]
      if (!override) return [name, definition]
      const { variant: _variant, ...withoutVariant } = definition
      return [
        name,
        {
          ...withoutVariant,
          model: override.model,
          ...(override.variant ? { variant: override.variant } : {}),
        },
      ]
    }),
  )
}

function evaluatorAgent(baseline: AgentDefinition, instruction: string, source: "audit-review" | "shadow-plan" | "shadow-implementation"): AgentDefinition {
  return {
    description: instruction,
    mode: "subagent",
    model: baseline.model,
    variant: baseline.variant,
    steps: 12,
    permission: { edit: "deny", bash: "deny", task: "deny" },
    prompt: `${instruction} Do not edit files or run mutating tools. Return concise reasoning followed by exactly one JSON object inside <flow-evaluation> tags. The JSON shape is {"source":"${source}","verdict":"good|mixed|bad|unknown","score":1-5,"note":"brief explanation"}.`,
  }
}

const DEFAULT_FLOW = "openai-commandcode-router"

const ANTIGRAVITY_TOOLS: Record<string, import("./src/telemetry/types.js").AntigravityCallType> = {
  antigravity_delegate: "foreground",
  antigravity_background_start: "background",
  antigravity_vision: "vision",
}

function antigravityCallType(tool: string): import("./src/telemetry/types.js").AntigravityCallType | undefined {
  return ANTIGRAVITY_TOOLS[tool]
}

/**
 * Resolve the active flow. A broken custom configuration degrades to the
 * built-in flow rather than throwing: this function runs before the hooks
 * object exists, so rejecting here would unregister every tool the user needs
 * to repair the configuration — including flow_configure itself.
 */
async function resolveFlow(
  name: string | undefined,
  orchestrationConfigPath: string,
): Promise<{ flow: FlowDefinition; configError?: string }> {
  const selected = name ?? DEFAULT_FLOW
  if (selected === "custom") {
    try {
      return { flow: buildFlowFromConfig(await loadOrchestrationConfig(orchestrationConfigPath)) }
    } catch (error) {
      return {
        flow: flows[DEFAULT_FLOW],
        configError: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const flow = flows[selected]
  if (!flow) throw new Error(`Unknown OpenCode agent flow: ${name}. Available: ${Object.keys(flows).join(", ")}, custom`)
  return { flow }
}

export default async function agentFlowsPlugin(input: any, options: PluginOptions = {}) {
  const telemetryOptions = options.telemetry ?? {}
  const reportDirectory = expandPath(telemetryOptions.reportDir ?? options.usageReportDir ?? defaultTelemetryDirectory())
  const orchestrationConfigPath = join(reportDirectory, "orchestration-config.json")
  const { flow, configError } = await resolveFlow(options.flow, orchestrationConfigPath)
  if (configError) console.warn(`opencode-agent-flows: using the built-in ${DEFAULT_FLOW} flow because the custom configuration could not be loaded. ${configError}`)
  const store = new TelemetryStore(reportDirectory, {
    dashboard: telemetryOptions.dashboard,
    retentionDays: telemetryOptions.retentionDays,
    orchestrationConfig: () => loadOrchestrationConfig(orchestrationConfigPath).catch(() => undefined),
  })
  const developerPath = join(reportDirectory, "developer-mode.json")
  const modelOverridesPath = join(reportDirectory, "model-overrides.json")
  let developerMode = await loadDeveloperMode(developerPath, developerDefaults(options))
  let modelOverrides = await loadModelOverrides(modelOverridesPath)
  let configuredAgents = applyModelOverrides(flow.agents, modelOverrides)
  const metadata: Record<string, AgentMetadata> = { ...flow.agentMetadata }
  const baseline = configuredAgents[flow.baselineAgent]
  if (baseline) {
    const billingSource = flow.agentMetadata[flow.baselineAgent]?.billingSource ?? "unknown"
    metadata["flow-audit-reviewer"] = {
      role: "evaluator",
      billingSource,
      risk: "low",
    }
    metadata["flow-shadow-planner"] = {
      role: "evaluator",
      billingSource,
      risk: "low",
    }
    metadata["flow-shadow-implementer"] = {
      role: "evaluator",
      billingSource,
      risk: "low",
    }
  }
  let runtimeFlow = {
    ...flow,
    agents: configuredAgents,
    agentMetadata: metadata,
  }
  const orchestrationPolicy = {
    maxTasksPerRun: options.orchestration?.maxTasksPerRun ?? flow.orchestration.maxTasksPerRun,
    maxConcurrentWorkers: options.orchestration?.maxConcurrentWorkers ?? flow.orchestration.maxConcurrentWorkers,
  }
  const reviewerPolicy = flow.reviewer
    ? {
        ...flow.reviewer,
        enabled: options.reviewer?.enabled ?? flow.reviewer.enabled,
        agent: options.reviewer?.agent ?? flow.reviewer.agent,
        sampleRate: options.reviewer?.sampleRate ?? flow.reviewer.sampleRate,
        maxRounds: options.reviewer?.maxRounds ?? flow.reviewer.maxRounds,
        maxFindings: options.reviewer?.maxFindings ?? flow.reviewer.maxFindings,
        maxPacketChars: options.reviewer?.maxPacketChars ?? flow.reviewer.maxPacketChars,
      }
    : undefined
  const activeRuns = new Map<string, RunState>()
  const sessionAgents = new Map<string, string>()
  const tasks = new Map<string, TaskTrace>()
  const taskAttempts = new Map<string, number>()
  const verification: VerificationEvidence[] = []
  const quality: QualityEvidence[] = []
  const approvals = new Map<string, Set<string>>()
  const shadowedAgents: string[] = []
  const antigravityCalls: AntigravityTrace[] = []

  async function resolveRoot(sessionID: string): Promise<SessionInfo | undefined> {
    let session = (await input.client?.session?.get({ path: { id: sessionID } }))?.data as SessionInfo | undefined
    while (session?.parentID) session = (await input.client.session.get({ path: { id: session.parentID } })).data as SessionInfo | undefined
    return session
  }

  async function collectSessions(root: SessionInfo) {
    const sessions: SessionInfo[] = [root]
    for (let index = 0; index < sessions.length; index += 1) {
      const children =
        (
          await input.client.session.children({
            path: { id: sessions[index].id },
          })
        ).data ?? []
      sessions.push(...children)
    }
    return Promise.all(
      sessions.map(async (session) => {
        const data = (await input.client.session.messages({ path: { id: session.id } })).data ?? []
        const messages = data.map((item: { info: RawMessage }) => normalizeMessage(item.info))
        const agent = messages.find((message: { role: string; agent?: string }) => message.role === "user")?.agent ?? sessionAgents.get(session.id)
        if (agent) sessionAgents.set(session.id, agent)
        return { id: session.id, parentID: session.parentID, agent, messages }
      }),
    )
  }

  async function correlatedTaskError(task: TaskTrace): Promise<string | undefined> {
    if (!input.client?.session) return undefined
    try {
      const children = (await input.client.session.children({ path: { id: task.sessionID } })).data ?? []
      const errors: string[] = []
      for (const child of children) {
        const messages = (await input.client.session.messages({ path: { id: child.id } })).data ?? []
        for (const item of messages as Array<{ info: RawMessage }>) {
          if ((item.info.time?.created ?? 0) < task.startedAt || item.info.error === undefined) continue
          const message = errorText(item.info.error)
          if (message && !errors.includes(message)) errors.push(message)
        }
      }
      return errors.slice(0, 3).join("; ") || undefined
    } catch {
      return undefined
    }
  }

  async function quotas() {
    const snapshots = []
    if (options.quota?.codex) snapshots.push(await readCodexQuota())
    snapshots.push(commandCodeBudget(await store.listRuns(), options.quota?.commandCodeMonthlyCreditsUsd))
    return snapshots
  }

  async function finalizeRun(rootSessionID: string): Promise<void> {
    const run = activeRuns.get(rootSessionID)
    if (!run || !input.client) return
    activeRuns.delete(rootSessionID)
    try {
      const root = (await input.client.session.get({ path: { id: rootSessionID } })).data as SessionInfo | undefined
      if (!root) return
      const sessions = await collectSessions(root)
      if (sessions[0]?.agent !== flow.defaultAgent) return
      const shared = {
        flow: runtimeFlow,
        rootSessionID,
        sessions,
        tasks: [...tasks.values()],
        verification,
        quality,
        quotas: await quotas(),
        displacementEfficiency: telemetryOptions.displacementEfficiency ?? options.displacementEfficiency ?? 0.75,
        pricing: normalizePricing(telemetryOptions.apiEquivalentPricing),
        developerMode,
        antigravityCalls: [...antigravityCalls],
      }
      const runReport = buildFlowReport({
        ...shared,
        runID: run.id,
        startedAt: run.startedAt,
      })
      const historical = (await store.listRuns()).filter((item) => item.runID !== runReport.runID || item.rootSessionID !== runReport.rootSessionID)
      const budget = commandCodeBudget([...historical, runReport], options.quota?.commandCodeMonthlyCreditsUsd)
      runReport.quotas = [...runReport.quotas.filter((item) => item.source !== "commandcode-local-budget"), budget]
      await store.writeReport(runReport)
      const sessionRuns = [...historical.filter((item) => item.rootSessionID === rootSessionID), runReport]
      await store.writeReport(buildFlowReport({
        ...shared,
        tasks: uniqueByID(sessionRuns.flatMap((item) => item.tasks)),
        verification: uniqueByID(sessionRuns.flatMap((item) => item.verification)),
        quality: uniqueByID(sessionRuns.flatMap((item) => item.quality)),
        antigravityCalls: uniqueByID(sessionRuns.flatMap((item) => item.antigravityCalls ?? [])),
      }))
      if (telemetryOptions.runSummaryToast ?? options.usageToast ?? true)
        await input.client.tui?.showToast({
          body: {
            title: `${flow.title}: run complete`,
            message: `${runReport.totals.subagentsSpawned} subagents | $${runReport.totals.costUsd.toFixed(4)} metered | $${runReport.totals.apiEquivalentCostUsd.toFixed(4)} API-equivalent`,
            variant: runReport.totals.taskFailures > 0 ? "warning" : "info",
            duration: 8_000,
          },
        })
    } catch (error) {
      console.warn("Failed to finalize agent flow telemetry", error)
    }
  }

  function developerInstructions(sessionID: string): string[] {
    if (!developerMode.enabled) return []
    const run = activeRuns.get(sessionID)
    if (!deterministicSample(`${flow.id}:${run?.id ?? sessionID}:${options.developer?.sampleSalt ?? "default"}`, developerMode.sampleRate))
      return ["Developer evaluation mode is enabled, but this run was not selected by its sampling rate."]
    const instructions = ["Developer evaluation mode selected this run. Evaluators must not modify production files."]
    if (developerMode.shadowPlanning) instructions.push("Before implementation, delegate a read-only independent plan to flow-shadow-planner and preserve its <flow-evaluation> JSON marker.")
    if (developerMode.shadowImplementation) instructions.push("Before implementation, request a read-only patch proposal from flow-shadow-implementer and preserve its <flow-evaluation> JSON marker.")
    if (developerMode.auditReview) instructions.push("Before the final answer, delegate a blind audit packet to flow-audit-reviewer and preserve its <flow-evaluation> JSON marker.")
    return instructions
  }

  function reviewerInstructions(sessionID: string): string[] {
    if (!reviewerPolicy?.enabled) return ["Automatic milestone review is disabled for this flow."]
    const run = activeRuns.get(sessionID)
    const sampled = deterministicSample(`${flow.id}:${run?.id ?? sessionID}:review`, reviewerPolicy.sampleRate)
    return [
      `Milestone review policy: 1 consolidated review by default, at most ${reviewerPolicy.maxRounds} total rounds, maximum ${reviewerPolicy.maxFindings} findings per round, and never one review per commit.`,
      `A second review is only allowed after non-trivial accepted fixes from the first round, and requires Finding Disposition and Non-trivial Fixes headings in the packet.`,
      sampled
        ? "This run was selected for sampled review if it produces a substantial self-contained changeset."
        : "This run was not selected for sampled review; explicit requests, final handoff milestones, and self-contained high-risk units still qualify.",
    ]
  }

  const developerTool = tool({
    description: "View or update persistent developer evaluation mode without editing opencode.json. Changes apply to the next root request.",
    args: {
      enabled: tool.schema.boolean().optional(),
      auditReview: tool.schema.boolean().optional(),
      shadowPlanning: tool.schema.boolean().optional(),
      shadowImplementation: tool.schema.boolean().optional(),
      sampleRate: tool.schema.number().min(0).max(1).optional(),
      reset: tool.schema.boolean().optional(),
    },
    async execute(args) {
      developerMode = args.reset
        ? developerDefaults(options)
        : {
            ...developerMode,
            ...Object.fromEntries(Object.entries(args).filter(([key, value]) => key !== "reset" && value !== undefined)),
          }
      await saveDeveloperMode(developerPath, developerMode)
      return `Developer mode: ${developerMode.enabled ? "enabled" : "disabled"}; audit=${developerMode.auditReview}; shadow plan=${developerMode.shadowPlanning}; shadow implementation=${developerMode.shadowImplementation}; sample rate=${developerMode.sampleRate}. Saved at ${developerPath}; no opencode.json edit or restart is needed.`
    },
  })

  function modelSummary(): string {
    return Object.entries(configuredAgents)
      .map(([name, agent]) => {
        const shipped = flow.agents[name]
        const override = modelOverrides[name]
        const suffix = override ? ` override; default ${shipped.model}${shipped.variant ? ` (${shipped.variant})` : ""}` : " default"
        return `- ${name}: ${agent.model}${agent.variant ? ` (${agent.variant})` : ""}${suffix}`
      })
      .join("\n")
  }

  const modelsTool = tool({
    description: "List persistent flow-agent model mappings, or set/reset one mapping. Changes apply after restarting OpenCode.",
    args: {
      agent: tool.schema.string().optional(),
      model: tool.schema.string().optional(),
      variant: tool.schema.string().optional(),
      reset: tool.schema.boolean().optional(),
    },
    async execute(args) {
      if (!args.agent) return `Flow models:\n${modelSummary()}\n\nUse flow_models with agent and model to save an override. Changes apply after restarting OpenCode.`
      if (!flow.agents[args.agent]) throw new Error(`Unknown flow agent: ${args.agent}. Available agents: ${Object.keys(flow.agents).join(", ")}`)
      if (args.reset) {
        delete modelOverrides[args.agent]
        configuredAgents = applyModelOverrides(flow.agents, modelOverrides)
        runtimeFlow = {
          ...flow,
          agents: configuredAgents,
          agentMetadata: metadata,
        }
        await saveModelOverrides(modelOverridesPath, modelOverrides)
        return `Reset ${args.agent} to ${configuredAgents[args.agent].model}${configuredAgents[args.agent].variant ? ` (${configuredAgents[args.agent].variant})` : ""}. Restart OpenCode to apply it.`
      }
      if (!args.model) throw new Error("model is required unless reset is true")
      if (!/^[^/\s]+\/\S+$/.test(args.model)) throw new Error("model must use provider/model format, for example commandcode/laguna-s-2.1-free or openrouter/anthropic/claude-sonnet-4")
      modelOverrides[args.agent] = {
        model: args.model,
        ...(args.variant ? { variant: args.variant } : {}),
      }
      configuredAgents = applyModelOverrides(flow.agents, modelOverrides)
      runtimeFlow = {
        ...flow,
        agents: configuredAgents,
        agentMetadata: metadata,
      }
      await saveModelOverrides(modelOverridesPath, modelOverrides)
      return `Saved ${args.agent}: ${args.model}${args.variant ? ` (${args.variant})` : ""}. The variant is cleared when omitted. Restart OpenCode to apply this override.`
    },
  })

  async function discoveredProviders() {
    try {
      const response = await input.client?.config?.providers?.()
      return normalizeProviders(response?.data ?? response)
    } catch {
      return []
    }
  }

  const discoverTool = tool({
    description:
      "Discover the OpenCode provider models available to you, enriched with models.dev pricing and Artificial Analysis quality, ranked per orchestration role. Use during setup to choose which model backs each role.",
    args: {
      role: tool.schema.string().optional(),
      refresh: tool.schema.boolean().optional(),
    },
    async execute(args) {
      const providers = await discoveredProviders()
      const result = await discoverCatalog({
        providers,
        cacheDir: join(reportDirectory, "cache"),
        refresh: args.refresh === true,
      })
      const role = args.role && (ORCHESTRATION_ROLES as readonly string[]).includes(args.role) ? (args.role as OrchestrationRole) : undefined
      return formatDiscovery(result, { role })
    },
  })

  const runProbe: ProbeRunner = async (probeCommand, args) => {
    try {
      const { stdout } = await promisify(execFile)(probeCommand, args, { timeout: 15_000 })
      return { stdout, code: 0 }
    } catch (error) {
      const err = error as { code?: number | null; stdout?: string }
      return { stdout: err.stdout ?? "", code: typeof err.code === "number" ? err.code : null }
    }
  }

  const antigravityTool = tool({
    description:
      "Check whether Google Antigravity (Gemini on a Google AI Pro subscription, via the agy CLI) is available, and how to route work to it. Gemini is an effectively-free helper for vision, large-context reads, and bulk work.",
    args: {
      command: tool.schema.string().optional().describe("Path to the agy binary (default: agy)."),
    },
    async execute(args) {
      const status = await detectAntigravity(runProbe, args.command ?? "agy")
      return formatAntigravityStatus(status)
    },
  })

  async function readOrchestrationConfig(): Promise<OrchestrationConfig | undefined> {
    try {
      return await loadOrchestrationConfig(orchestrationConfigPath)
    } catch {
      return undefined
    }
  }

  const configViewTool = tool({
    description: "Show the saved orchestration configuration: which model backs each role, how it is billed, and whether it is currently active.",
    args: {},
    async execute() {
      const view = formatOrchestrationConfig(await readOrchestrationConfig(), {
        path: orchestrationConfigPath,
        active: options.flow === "custom" && !configError,
      })
      const shadowNote = shadowedAgents.length
        ? `\n\n> Note: ${shadowedAgents.join(", ")} are defined elsewhere and keep that definition. If you did not define them yourself, this plugin is likely loaded twice (globally and per project); remove one copy.`
        : ""
      if (!configError) return view + shadowNote
      return [
        `> Your configuration could not be loaded, so the built-in ${DEFAULT_FLOW} flow is running instead.`,
        `> Reason: ${configError}`,
        "> Fix it with flow_configure, or re-run the flow-setup command, then restart OpenCode.",
        "",
        view + shadowNote,
      ].join("\n")
    },
  })

  const configureTool = tool({
    description:
      "Persist the orchestration configuration. Pass roles as a JSON object to set every role at once, or role plus model to change a single role. Restart OpenCode to apply.",
    args: {
      roles: tool.schema.string().optional(),
      role: tool.schema.string().optional(),
      model: tool.schema.string().optional(),
      variant: tool.schema.string().optional(),
      billingSource: tool.schema.string().optional(),
      effectiveCostNote: tool.schema.string().optional(),
      title: tool.schema.string().optional(),
      maxTasksPerRun: tool.schema.number().optional(),
      maxConcurrentWorkers: tool.schema.number().optional(),
      reviewerEnabled: tool.schema.boolean().optional(),
      reset: tool.schema.boolean().optional(),
    },
    async execute(args) {
      const current = await readOrchestrationConfig()

      if (args.reset) {
        // Delete unconditionally: readOrchestrationConfig also swallows parse
        // and validation errors, so refusing when `current` is undefined would
        // refuse exactly the corrupt file that most needs removing.
        await rm(orchestrationConfigPath, { force: true })
        return `Removed ${orchestrationConfigPath}. The plugin falls back to its built-in ${DEFAULT_FLOW} flow until you configure again.`
      }

      const draft: Record<string, unknown> = current
        ? { ...current, roles: { ...current.roles } }
        : { version: ORCHESTRATION_CONFIG_VERSION, roles: {} }

      if (args.roles) {
        let parsed: unknown
        try {
          parsed = JSON.parse(args.roles)
        } catch (error) {
          throw new Error(`roles must be a JSON object of role -> binding: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (typeof parsed !== "object" || parsed === null) throw new Error("roles must be a JSON object of role -> binding")
        draft.roles = parsed
      }

      if (args.role) {
        if (!(ORCHESTRATION_ROLES as readonly string[]).includes(args.role))
          throw new Error(`Unknown role: ${args.role}. Available roles: ${ORCHESTRATION_ROLES.join(", ")}`)
        if (!args.model) throw new Error("model is required when setting a single role")
        if (args.billingSource && !(BILLING_SOURCES as readonly string[]).includes(args.billingSource))
          throw new Error(`Unknown billingSource: ${args.billingSource}. Available: ${BILLING_SOURCES.join(", ")}`)
        ;(draft.roles as Record<string, unknown>)[args.role] = {
          model: args.model,
          ...(args.variant ? { variant: args.variant } : {}),
          ...(args.billingSource ? { billingSource: args.billingSource } : {}),
          ...(args.effectiveCostNote ? { effectiveCostNote: args.effectiveCostNote } : {}),
        }
      }

      if (args.title !== undefined) draft.title = args.title
      if (args.maxTasksPerRun !== undefined || args.maxConcurrentWorkers !== undefined)
        draft.orchestration = {
          ...(draft.orchestration as Record<string, unknown> | undefined),
          ...(args.maxTasksPerRun !== undefined ? { maxTasksPerRun: args.maxTasksPerRun } : {}),
          ...(args.maxConcurrentWorkers !== undefined ? { maxConcurrentWorkers: args.maxConcurrentWorkers } : {}),
        }
      if (args.reviewerEnabled !== undefined)
        draft.reviewer = { ...(draft.reviewer as Record<string, unknown> | undefined), enabled: args.reviewerEnabled }

      if (!args.roles && !args.role && args.title === undefined && args.maxTasksPerRun === undefined && args.maxConcurrentWorkers === undefined && args.reviewerEnabled === undefined)
        return formatOrchestrationConfig(current, { path: orchestrationConfigPath, active: options.flow === "custom" })

      const normalized = normalizeOrchestrationConfig(draft)
      await saveOrchestrationConfig(orchestrationConfigPath, normalized)
      return [
        formatOrchestrationConfig(normalized, { path: orchestrationConfigPath, active: options.flow === "custom" }),
        "",
        "Saved. Restart OpenCode to apply.",
      ].join("\n")
    },
  })

  const statusTool = tool({
    description: "Show agent-flow telemetry for the latest run, current session, or all recorded runs.",
    args: {
      scope: tool.schema.enum(["run", "session", "global"]).default("run"),
    },
    async execute(args, context) {
      if (args.scope === "global") return globalReportMarkdown(await store.global())
      const root = await resolveRoot(context.sessionID)
      if (!root) return "Could not resolve the current root session."
      const report = args.scope === "run" ? await store.latestRunForSession(root.id) : await store.session(root.id)
      return report ? flowReportMarkdown(report) : `No completed ${args.scope} report is available yet.`
    },
  })
  const dashboardTool = tool({
    description: "Return the cross-client HTML dashboard and report locations for agent-flow telemetry.",
    args: {},
    async execute() {
      await store.rebuildGlobal()
      return `Dashboard: file://${reportDirectory}/dashboard.html\nLatest run: ${reportDirectory}/latest-run.md\nGlobal report: ${reportDirectory}/global.md\nDeveloper controls: flow_developer_mode`
    },
  })
  const feedbackTool = tool({
    description: "Record explicit user feedback for the latest completed agent-flow run.",
    args: {
      rating: tool.schema.enum(["good", "mixed", "bad"]),
      note: tool.schema.string().max(2_000).optional(),
    },
    async execute(args, context) {
      const root = await resolveRoot(context.sessionID)
      if (!root) throw new Error("Could not resolve the current root session")
      await store.appendFeedback(root.id, {
        id: crypto.randomUUID(),
        sessionID: root.id,
        source: "feedback",
        verdict: args.rating,
        note: args.note,
        observedAt: Date.now(),
      })
      return `Recorded ${args.rating} feedback for the latest completed run.`
    },
  })
  const approvalTool = tool({
    description: "Request a hard permission prompt before using an approval-gated escalation agent.",
    args: { agent: tool.schema.string() },
    async execute(args, context) {
      if (!flow.agentMetadata[args.agent]?.requiresApproval && !options.guardrails?.approvalAgents?.includes(args.agent)) return `${args.agent} does not require plugin approval.`
      await context.ask({
        permission: "flow_escalation",
        patterns: [args.agent],
        always: [],
        metadata: { agent: args.agent, flow: flow.id },
      })
      const root = await resolveRoot(context.sessionID)
      if (!root) throw new Error("Could not resolve the root session")
      const approved = approvals.get(root.id) ?? new Set<string>()
      approved.add(args.agent)
      approvals.set(root.id, approved)
      return `Approved one use of ${args.agent} for this root session.`
    },
  })

  const hooks: any = {
    config: async (config: OpenCodeConfig) => {
      config.agent ??= {}
      for (const [name, definition] of Object.entries(configuredAgents)) {
        // Someone else already defined this agent. That is supported — your own
        // agent definitions win — but it also happens when this plugin is
        // installed twice (say globally from npm and again per project), where
        // whichever instance loads first silently supplies every agent. That
        // failure is invisible and hard to diagnose, so record it.
        const existing = config.agent[name] as AgentDefinition | undefined
        if (existing && !modelOverrides[name] && existing.model && existing.model !== definition.model) shadowedAgents.push(name)
        if (modelOverrides[name] && config.agent[name]) {
          const { variant: _variant, ...withoutVariant } = config.agent[name] as AgentDefinition
          config.agent[name] = {
            ...withoutVariant,
            model: definition.model,
            ...(definition.variant ? { variant: definition.variant } : {}),
          }
        } else {
          config.agent[name] ??= definition
        }
      }
      if (baseline) {
        config.agent["flow-audit-reviewer"] ??= evaluatorAgent(baseline, "Blindly audit the completed diff and verification evidence.", "audit-review")
        config.agent["flow-shadow-planner"] ??= evaluatorAgent(baseline, "Create an independent read-only implementation plan.", "shadow-plan")
        config.agent["flow-shadow-implementer"] ??= evaluatorAgent(baseline, "Create a read-only patch proposal without modifying files.", "shadow-implementation")
      }
      if (shadowedAgents.length)
        console.warn(
          `opencode-agent-flows: ${shadowedAgents.join(", ")} were already defined elsewhere and keep that definition. If you did not define them yourself, this plugin is probably loaded twice (for example globally and per project); remove one copy.`,
        )
      if (options.setDefault !== false) config.default_agent ??= flow.defaultAgent
      config.command ??= {}
      config.command["flow-setup"] ??= {
        template: SETUP_COMMAND_TEMPLATE,
        description: "Interview to choose which model backs each orchestration role, using your available providers, pricing, and effective cost.",
        agent: flow.defaultAgent,
      }
      config.command["flow-config"] ??= {
        template: CONFIG_COMMAND_TEMPLATE,
        description: "Show the saved orchestration configuration.",
        agent: flow.defaultAgent,
      }
    },
    tool: {
      flow_status: statusTool,
      flow_dashboard: dashboardTool,
      flow_feedback: feedbackTool,
      flow_approve_escalation: approvalTool,
      flow_developer_mode: developerTool,
      flow_models: modelsTool,
      flow_discover_models: discoverTool,
      flow_config: configViewTool,
      flow_configure: configureTool,
      flow_antigravity: antigravityTool,
    },
    "chat.message": async (chatInput: { sessionID: string; agent?: string; messageID?: string }, output: { message: RawMessage }) => {
      if (chatInput.agent) sessionAgents.set(chatInput.sessionID, chatInput.agent)
      const root = await resolveRoot(chatInput.sessionID)
      if (!root || root.id !== chatInput.sessionID || chatInput.agent !== flow.defaultAgent) return
      const existing = activeRuns.get(root.id)
      activeRuns.set(root.id, {
        id: existing?.id ?? (chatInput.messageID ?? output.message.id ?? crypto.randomUUID()),
        rootSessionID: root.id,
        startedAt: existing?.startedAt ?? (output.message.time?.created ?? Date.now()),
      })
    },
    "experimental.chat.system.transform": async (systemInput: { sessionID?: string }, output: { system: string[] }) => {
      if (!systemInput.sessionID) return
      const root = await resolveRoot(systemInput.sessionID)
      if (root && root.id === systemInput.sessionID) output.system.push(...developerInstructions(root.id), ...reviewerInstructions(root.id))
    },
    "tool.execute.before": async (toolInput: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const root = await resolveRoot(toolInput.sessionID)
      const run = root ? activeRuns.get(root.id) : undefined

      const antigravityType = antigravityCallType(toolInput.tool)
      if (antigravityType) {
        antigravityCalls.push({
          id: crypto.randomUUID(),
          callID: toolInput.callID,
          sessionID: toolInput.sessionID,
          runID: run?.id,
          type: antigravityType,
          tool: toolInput.tool,
          model: typeof output.args.model === "string" ? output.args.model : undefined,
          status: "running",
          startedAt: Date.now(),
        })
      }

      const agent = sessionAgents.get(toolInput.sessionID)
      const role = agent ? metadata[agent]?.role : undefined
      if ((role === "evaluator" || role === "reviewer") && ["edit", "write", "apply_patch", "bash", "task"].includes(toolInput.tool))
        throw new Error(`${role === "reviewer" ? "Reviewer" : "Evaluator"} ${agent} is read-only and cannot use ${toolInput.tool}`)
      if (toolInput.tool === "task") {
        const delegated = String(output.args.subagent_type ?? output.args.agent ?? "unknown")
        const description = typeof output.args.description === "string" ? output.args.description : ""
        const prompt = typeof output.args.prompt === "string" ? output.args.prompt : ""
        const packet = prompt || description
        const packetFieldName = prompt ? "prompt" : "description"
        const setPacket = (value: string) => { output.args[packetFieldName] = value }
        const delegatedRole = metadata[delegated]?.role
        const runTasks = [...tasks.values()].filter((task) => task.runID === run?.id)
        let execClass: ExecutionClass | undefined
        let expectedScope: string[] | undefined
        if (run && runTasks.length >= orchestrationPolicy.maxTasksPerRun)
          throw new Error(`run reached the ${orchestrationPolicy.maxTasksPerRun}-task delegation budget; return a partial result or ask the user`)
        if (agent === flow.defaultAgent && (delegatedRole === "worker" || delegatedRole === "bulk-worker")) {
          execClass = parseExecutionClass(packet)
          if (execClass === undefined)
            throw new Error(`worker task must declare an Execution Class: read-only, shared-write, or integration; add an "Execution Class" heading to the packet`)
          expectedScope = parseExpectedScope(packet)
          if (!expectedScope || expectedScope.length === 0)
            throw new Error("worker task must supply a non-empty Expected Scope: a comma/semicolon-separated path or directory pattern manifest (e.g. src/**/*.ts, src/parser.ts)")
          const runningWorkerTasks = runTasks.filter((task) =>
            task.status === "running" && ["worker", "bulk-worker"].includes(metadata[task.agent ?? ""]?.role ?? ""),
          )
          // Homogeneous frontier: only read-only tasks may share the concurrency
          // pool. A shared-write or integration task needs the frontier empty,
          // and a read-only task must wait while any writer is active so it
          // cannot observe a partial write in progress.
          if (execClass === "read-only") {
            const activeWriters = runningWorkerTasks.filter((t) => t.executionClass !== "read-only")
            if (activeWriters.length > 0)
              throw new Error("a shared-write or integration task is active; wait for it to finish before starting a read-only task")
            if (runningWorkerTasks.length >= orchestrationPolicy.maxConcurrentWorkers)
              throw new Error(`run reached the ${orchestrationPolicy.maxConcurrentWorkers}-worker concurrency limit; integrate the current frontier first`)
          } else {
            if (runningWorkerTasks.length > 0)
              throw new Error("shared-write and integration tasks must run one at a time; wait for the current worker to finish")
          }
          if (delegatedRole === "worker" && packet.length > MAX_WORK_PACKET_CHARS)
            throw new Error(`routine work packet exceeds the ${MAX_WORK_PACKET_CHARS}-character surface-level planning budget`)
          if (!packet.includes("## Worker Execution Contract")) setPacket(`${packet}${WORK_REPORT_CONTRACT}`)
        }
        if (agent === flow.defaultAgent && delegated === "deep") {
          const routineBlocked = runTasks.some((task) => task.agent === "routine" && ["failed", "blocked"].includes(task.status))
          if (!routineBlocked) throw new Error("deep requires a failed or blocked routine attempt in the current run")
          if (!packet.includes("## Worker Execution Contract")) setPacket(`${packet}${WORK_REPORT_CONTRACT}`)
        }
        if (agent === flow.defaultAgent && delegated === reviewerPolicy?.agent) {
          if (!reviewerPolicy.enabled) throw new Error("milestone review is disabled")
          if (packet.length > reviewerPolicy.maxPacketChars) throw new Error(`review packet exceeds the ${reviewerPolicy.maxPacketChars}-character limit`)
          const missing = missingPacketHeadings(packet, REVIEW_PACKET_HEADINGS)
          if (missing.length > 0) throw new Error(`review packet is missing headings: ${missing.join(", ")}`)
          const priorReviews = runTasks.filter((task) => task.agent === reviewerPolicy.agent)
          if (priorReviews.length >= reviewerPolicy.maxRounds) throw new Error(`review reached the ${reviewerPolicy.maxRounds}-round limit; triage remaining findings and stop`)
          if (priorReviews.length > 0) {
            const previous = priorReviews.at(-1)
            if (previous?.reviewReport?.verdict !== "changes-requested") throw new Error("re-review requires a prior changes-requested verdict")
            const followupMissing = missingPacketHeadings(packet, ["Finding Disposition", "Non-trivial Fixes"])
            if (followupMissing.length > 0) throw new Error(`second review requires headings: ${followupMissing.join(", ")}`)
          }
          if (!packet.includes("## Review Execution Contract"))
            setPacket(`${packet}${REVIEW_REPORT_CONTRACT
              .replace("{CURRENT_ROUND}", String(priorReviews.length + 1))
              .replace("{MAX_ROUNDS}", String(reviewerPolicy.maxRounds))
              .replace("{MAX_FINDINGS}", String(reviewerPolicy.maxFindings))}`)
        }
        const packetDescription = typeof output.args[packetFieldName] === "string" ? output.args[packetFieldName] as string : packet
        const taskID = stableTaskID(packet)
        if (runTasks.some((task) => task.status === "running" && task.agent === delegated && task.taskID === taskID))
          throw new Error(`task ${taskID} is already running; do not launch duplicate concurrent attempts`)
        if (run && (delegatedRole === "worker" || delegatedRole === "bulk-worker")) {
          const key = `${run.id}:${delegated}:${taskID}`
          const attempt = taskAttempts.get(key) ?? 0
          const maximum = options.verification?.maxWorkerAttempts ?? flow.verification.maxWorkerAttempts
          if (attempt >= maximum) throw new Error(`${delegated} reached the ${maximum}-attempt limit for task ${taskID}; escalate or ask the user`)
          taskAttempts.set(key, attempt + 1)
          if (attempt > 0) {
            const prior = [...tasks.values()].filter(
              (t) => t.runID === run.id && t.agent === delegated && t.taskID === taskID,
            ).sort((a, b) => b.startedAt - a.startedAt)[0]
            if (prior) {
              const contextParts: string[] = []
              if (prior.status !== "running") contextParts.push(`status: ${prior.status}`)
              if (prior.error) contextParts.push(`error: ${prior.error}`)
              if (prior.workReport?.summary) contextParts.push(`summary: ${prior.workReport.summary}`)
              if (prior.workReport?.blocker) contextParts.push(`blocker: ${prior.workReport.blocker}`)
              if (prior.workReportError) contextParts.push(`report-error: ${prior.workReportError}`)
              if (contextParts.length > 0) {
                setPacket(`${output.args[packetFieldName]}\n\n## Retry Context\nAttempt ${attempt + 1} of ${maximum} for Task ID ${taskID}. Prior attempt: ${contextParts.join("; ")}.`)
              }
            }
          }
        }
        if (flow.agentMetadata[delegated]?.requiresApproval && !approvals.get(root?.id ?? "")?.delete(delegated)) throw new Error(`${delegated} requires flow_approve_escalation before delegation`)
        tasks.set(toolInput.callID, {
          id: crypto.randomUUID(),
          callID: toolInput.callID,
          sessionID: toolInput.sessionID,
          runID: run?.id,
          taskID,
          agent: delegated,
          description: packetDescription,
          model: runtimeFlow.agents[delegated]?.model,
          status: "running",
          executionClass: execClass,
          expectedScope,
          startedAt: Date.now(),
          linkConfidence: "explicit",
        })
      }
      // Defense-in-depth: when homogeneous frontiers are enforced, a read-only
      // task can never overlap with a writer, so agent-name matching inherently
      // blocks every legitimate writer. This guard is redundant with frontier
      // homogeneity but is kept as a secondary layer; it does not attempt
      // callID/session correlation because those links are unreliable across
      // tool calls from the same agent.
      if ((role === "worker" || role === "bulk-worker") && ["edit", "write", "apply_patch", "bash", "task"].includes(toolInput.tool)) {
        const workerTask = [...tasks.values()].find(
          (t) => t.agent === agent && t.status === "running" && t.executionClass === "read-only",
        )
        if (workerTask)
          throw new Error(`read-only worker ${agent} cannot use ${toolInput.tool}; the task was dispatched as read-only (Execution Class: read-only)`)
      }
      if (
        (options.guardrails?.enabled ?? true) &&
        (role === "worker" || role === "bulk-worker") &&
        ["edit", "write", "apply_patch", "bash"].includes(toolInput.tool)
      ) {
        const matched = pathProtected(output.args, options.guardrails?.protectedPaths ?? DEFAULT_PROTECTED_PATHS)
        if (matched) throw new Error(`Protected path policy blocked ${agent}: matched ${matched}`)
      }
      if (toolInput.tool === "bash") {
        const command = String(output.args.command ?? "")
        const category = verificationCategory(command)
        if (category)
          verification.push({
            id: toolInput.callID,
            runID: run?.id,
            sessionID: toolInput.sessionID,
            command: command.slice(0, 1_000),
            category,
            status: "unknown",
            observedAt: Date.now(),
          })
      }
    },
    "tool.execute.after": async (toolInput: { callID: string }, output: { output: string; metadata?: Record<string, unknown> }) => {
      const agCall = antigravityCalls.find((c) => c.callID === toolInput.callID)
      if (agCall) {
        if (agCall.status !== "failed") agCall.status = "completed"
        agCall.completedAt = Date.now()
        agCall.durationMs = agCall.completedAt - agCall.startedAt
      }
      const task = tasks.get(toolInput.callID)
      if (task) {
        if (task.status !== "failed") task.status = "completed"
        task.completedAt = Date.now()
        const taskRole = metadata[task.agent ?? ""]?.role
        if (task.status !== "failed" && output.output.trim() === "") {
          task.status = "failed"
          task.error = (await correlatedTaskError(task)) ?? "Task returned empty output"
          output.output = `[Flow task failure: ${task.error}]`
        }
        if (task.status !== "failed" && (taskRole === "worker" || task.agent === "deep")) {
          const result = parseWorkReport(output.output)
          if (result.report) {
            task.workReport = result.report
            if (result.report.status === "blocked") task.status = "blocked"
          } else {
            task.status = "invalid-output"
            task.workReportError = result.error
            output.output += `\n\n[Flow guardrail: this worker result has invalid output because ${result.error}. Do not spawn another worker solely to repair formatting. Use the substantive evidence already returned, retry the same stable Task ID only for substantive missing work, or stop.]`
          }
        }
        if (task.status !== "failed" && taskRole === "reviewer") {
          const result = parseReviewReport(output.output, reviewerPolicy?.maxFindings ?? 5)
          if (result.report) {
            task.reviewReport = result.report
            quality.push({
              id: crypto.randomUUID(),
              runID: task.runID,
              sessionID: task.sessionID,
              source: "cheap-review",
              verdict: result.report.verdict === "pass" ? "good" : result.report.verdict === "changes-requested" ? "mixed" : "bad",
              note: result.report.summary.slice(0, 2_000),
              observedAt: Date.now(),
            })
            const completedRoundCount = [...tasks.values()].filter(
              (t) => t.runID === task.runID && t.agent === reviewerPolicy?.agent && t.reviewReport !== undefined,
            ).length
            const remainingRounds = (reviewerPolicy?.maxRounds ?? 2) - completedRoundCount
            output.output += `\n\n[Flow: milestone review round ${completedRoundCount} of ${reviewerPolicy?.maxRounds ?? 2} is complete. Verdict: ${result.report.verdict}. ${remainingRounds > 0 ? `${remainingRounds} round(s) remaining.` : "Review budget exhausted."}]`
          } else {
            task.status = "invalid-output"
            task.reviewReportError = result.error
            const priorReviewCount = [...tasks.values()].filter(
              (t) => t.runID === task.runID && t.agent === reviewerPolicy?.agent && t.id !== task.id,
            ).length
            const currentRound = priorReviewCount + 1
            const remainingRounds = (reviewerPolicy?.maxRounds ?? 2) - currentRound
            output.output += `\n\n[Flow guardrail: milestone review round ${currentRound} of ${reviewerPolicy?.maxRounds ?? 2} has invalid output because ${result.error}. ${remainingRounds > 0 ? `${remainingRounds} round(s) remaining. ` : ""}Disclose that review was unavailable and perform one careful diff self-review; do not loop on review formatting.]`
          }
        }
        const evidence = parseEvaluation(output.output, task.runID, task.sessionID)
        if (evidence) quality.push(evidence)

        // The overlap check only fires on the second finisher's
        // tool.execute.after because the first finisher cannot yet know what
        // files its concurrent peer will report in filesChanged. After both
        // finish, each file intersection is written as a warning only on the
        // later output. This is a one-sided mechanism: overlapping groups of
        // three or more report the pairwise intersections that include the
        // latest finisher.
        if (task.workReport?.filesChanged && task.workReport.filesChanged.length > 0) {
          const runCompletedWithFiles = [...tasks.values()].filter(
            (t) =>
              t.runID === task.runID &&
              t.id !== task.id &&
              t.workReport?.filesChanged &&
              t.workReport.filesChanged.length > 0 &&
              t.completedAt !== undefined &&
              t.startedAt <= task.completedAt! &&
              task.startedAt <= t.completedAt,
          )
          const overlapping: string[] = []
          for (const other of runCompletedWithFiles) {
            const shared = other.workReport!.filesChanged.filter((file) => task.workReport!.filesChanged.includes(file))
            if (shared.length > 0) overlapping.push(`[${other.agent ?? "unknown"}: ${shared.join(", ")}]`)
          }
          if (overlapping.length > 0) {
            output.output += `\n\n[Flow: overlapping completed worker filesChanged in the same concurrent frontier. Other workers touched the same files: ${overlapping.join(" ")}. The orchestrator should verify that these writes are safe and not a silent conflict.]`
          }
        }
      }
      const check = verification.find((item) => item.id === toolInput.callID)
      if (check) {
        if (check.status !== "failed") check.status = "passed"
        if (typeof output.metadata?.duration === "number") check.durationMs = output.metadata.duration
      }
    },
    event: async ({ event }: any) => {
      const part = event.properties?.part
      if (event.type === "message.part.updated" && part?.type === "tool" && part.callID && part.state?.status === "error") {
        const task = tasks.get(part.callID)
        if (task) {
          task.status = "failed"
          task.error = typeof part.state.error === "string" ? part.state.error : JSON.stringify(part.state.error ?? "tool execution failed")
          task.completedAt = part.state.time?.end ?? Date.now()
        }
        const check = verification.find((item) => item.id === part.callID)
        if (check) check.status = "failed"
        const agCall = antigravityCalls.find((c) => c.callID === part.callID)
        if (agCall) {
          agCall.status = "failed"
          agCall.completedAt = part.state.time?.end ?? Date.now()
          agCall.durationMs = (agCall.completedAt ?? Date.now()) - agCall.startedAt
        }
      }
      const idle = event.type === "session.idle" || (event.type === "session.status" && event.properties?.status?.type === "idle")
      if (!idle || !event.properties?.sessionID) return
      const root = await resolveRoot(event.properties.sessionID)
      if (root && root.id === event.properties.sessionID) await finalizeRun(root.id)
    },
  }
  return hooks
}
