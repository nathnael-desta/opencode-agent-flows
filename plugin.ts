import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { flows } from "./src/flows/index.js"
import type { AgentDefinition, AgentMetadata, OpenCodeConfig, PluginOptions } from "./src/types.js"
import { expandPath, defaultTelemetryDirectory } from "./src/telemetry/path.js"
import { normalizePricing } from "./src/telemetry/pricing.js"
import { commandCodeBudget, readCodexQuota } from "./src/telemetry/quota.js"
import { buildFlowReport } from "./src/telemetry/reports.js"
import { TelemetryStore } from "./src/telemetry/store.js"
import type { DeveloperModeSnapshot, QualityEvidence, TaskTrace, VerificationEvidence, WorkReport } from "./src/telemetry/types.js"
import { flowReportMarkdown, globalReportMarkdown } from "./src/telemetry/markdown.js"

interface RunState { id: string; rootSessionID: string; startedAt: number }
interface SessionInfo { id: string; parentID?: string }
interface RawMessage { id?: string; role: "user" | "assistant"; agent?: string; providerID?: string; modelID?: string; variant?: string; cost?: number; tokens?: Record<string, number>; time?: { created?: number; completed?: number } }

const DEFAULT_PROTECTED_PATHS = [".env", "auth", "billing", "infrastructure", "migrations"]
const WORK_PACKET_HEADINGS = ["Objective", "Scope", "Constraints", "Acceptance", "Verification", "Escalate When", "Return"]
const DEEP_PACKET_HEADINGS = [...WORK_PACKET_HEADINGS, "Escalation Evidence"]
const MAX_WORK_PACKET_CHARS = 3_000
const WORK_REPORT_CONTRACT = `\n\n## Worker Execution Contract\nInspect the repository before editing. Treat the packet's file and implementation assumptions as hypotheses: correct them when repository evidence requires it, but do not silently broaden the behavioral scope. Stop and report a blocker when the requirements conflict, the scope must expand, or safe verification is unavailable. End with exactly one <flow-work-report> JSON object: {"status":"completed|blocked","summary":"...","filesChanged":["..."],"verification":[{"command":"...","status":"passed|failed|not-run"}],"scopeChanges":["..."],"blocker":"optional"}.`

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
    tokens: tokens ? {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cacheRead: tokens.cacheRead ?? tokens.cache_read ?? 0,
      cacheWrite: tokens.cacheWrite ?? tokens.cache_write ?? 0,
    } : undefined,
    createdAt: message.time?.created,
    completedAt: message.time?.completed,
  }
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

function pathProtected(value: unknown, patterns: string[]): string | undefined {
  const text = JSON.stringify(value).replaceAll("\\", "/").toLowerCase()
  return patterns.find((pattern) => text.includes(pattern.toLowerCase().replaceAll("**/", "").replaceAll("/**", "").replaceAll("*", "")))
}

function missingPacketHeadings(description: string, headings: string[]): string[] {
  return headings.filter((heading) => !new RegExp(`(?:^|\\n)\\s{0,3}(?:#+\\s*)?(?:\\*\\*)?${heading}(?:\\*\\*)?\\s*:?(?:\\s*\\n|\\s+\\S)`, "im").test(description))
}

function parseWorkReport(output: string): { report?: WorkReport; error?: string } {
  const match = output.match(/<flow-work-report>\s*([\s\S]*?)\s*<\/flow-work-report>/)
  if (!match) return { error: "missing <flow-work-report>" }
  try {
    const value = JSON.parse(match[1]) as Partial<WorkReport>
    const validStatus = value.status === "completed" || value.status === "blocked"
    const validFiles = Array.isArray(value.filesChanged) && value.filesChanged.every((item) => typeof item === "string")
    const validScope = Array.isArray(value.scopeChanges) && value.scopeChanges.every((item) => typeof item === "string")
    const validVerification = Array.isArray(value.verification) && value.verification.every((item) => typeof item === "object" && item !== null && typeof item.command === "string" && (item.status === "passed" || item.status === "failed" || item.status === "not-run"))
    if (!validStatus || typeof value.summary !== "string" || !validFiles || !validScope || !validVerification || (value.blocker !== undefined && typeof value.blocker !== "string")) return { error: "invalid <flow-work-report> schema" }
    return { report: { status: value.status as WorkReport["status"], summary: value.summary, filesChanged: value.filesChanged as string[], verification: value.verification as WorkReport["verification"], scopeChanges: value.scopeChanges as string[], blocker: value.blocker } }
  } catch {
    return { error: "invalid JSON in <flow-work-report>" }
  }
}

function parseEvaluation(output: string, runID?: string, sessionID?: string): QualityEvidence | undefined {
  const match = output.match(/<flow-evaluation>\s*([\s\S]*?)\s*<\/flow-evaluation>/)
  if (!match) return undefined
  try {
    const value = JSON.parse(match[1]) as { source?: QualityEvidence["source"]; verdict?: QualityEvidence["verdict"]; score?: number; note?: string }
    if (!value.source || !value.verdict || !["cheap-review", "audit-review", "shadow-plan", "shadow-implementation"].includes(value.source) || !["good", "mixed", "bad", "unknown"].includes(value.verdict)) return undefined
    return { id: crypto.randomUUID(), runID, sessionID, source: value.source, verdict: value.verdict, score: value.score, note: value.note?.slice(0, 2_000), observedAt: Date.now() }
  } catch { return undefined }
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
    return { ...defaults, ...saved, sampleRate: Math.max(0, Math.min(1, saved.sampleRate ?? defaults.sampleRate)) }
  } catch { return defaults }
}

async function saveDeveloperMode(path: string, state: DeveloperModeSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}

function evaluatorAgent(baseline: AgentDefinition, instruction: string, source: "audit-review" | "shadow-plan" | "shadow-implementation"): AgentDefinition {
  return {
    description: instruction,
    mode: "subagent",
    model: baseline.model,
    variant: baseline.variant,
    permission: { edit: "deny", bash: "deny", task: "deny" },
    prompt: `${instruction} Do not edit files or run mutating tools. Return concise reasoning followed by exactly one JSON object inside <flow-evaluation> tags. The JSON shape is {"source":"${source}","verdict":"good|mixed|bad|unknown","score":1-5,"note":"brief explanation"}.`,
  }
}

export default async function agentFlowsPlugin(input: any, options: PluginOptions = {}) {
  const flow = flows[options.flow ?? "openai-commandcode-router"]
  if (!flow) throw new Error(`Unknown OpenCode agent flow: ${options.flow}`)
  const telemetryOptions = options.telemetry ?? {}
  const reportDirectory = expandPath(telemetryOptions.reportDir ?? options.usageReportDir ?? defaultTelemetryDirectory())
  const store = new TelemetryStore(reportDirectory, { dashboard: telemetryOptions.dashboard, retentionDays: telemetryOptions.retentionDays })
  const developerPath = join(reportDirectory, "developer-mode.json")
  let developerMode = await loadDeveloperMode(developerPath, developerDefaults(options))
  const metadata: Record<string, AgentMetadata> = { ...flow.agentMetadata }
  const baseline = flow.agents[flow.baselineAgent]
  if (baseline) {
    const billingSource = flow.agentMetadata[flow.baselineAgent]?.billingSource ?? "unknown"
    metadata["flow-audit-reviewer"] = { role: "evaluator", billingSource, risk: "low" }
    metadata["flow-shadow-planner"] = { role: "evaluator", billingSource, risk: "low" }
    metadata["flow-shadow-implementer"] = { role: "evaluator", billingSource, risk: "low" }
  }
  const runtimeFlow = { ...flow, agentMetadata: metadata }
  const activeRuns = new Map<string, RunState>()
  const sessionAgents = new Map<string, string>()
  const tasks = new Map<string, TaskTrace>()
  const taskAttempts = new Map<string, number>()
  const verification: VerificationEvidence[] = []
  const quality: QualityEvidence[] = []
  const approvals = new Map<string, Set<string>>()

  async function resolveRoot(sessionID: string): Promise<SessionInfo | undefined> {
    let session = (await input.client?.session?.get({ path: { id: sessionID } }))?.data as SessionInfo | undefined
    while (session?.parentID) session = (await input.client.session.get({ path: { id: session.parentID } })).data as SessionInfo | undefined
    return session
  }

  async function collectSessions(root: SessionInfo) {
    const sessions: SessionInfo[] = [root]
    for (let index = 0; index < sessions.length; index += 1) {
      const children = (await input.client.session.children({ path: { id: sessions[index].id } })).data ?? []
      sessions.push(...children)
    }
    return Promise.all(sessions.map(async (session) => {
      const data = (await input.client.session.messages({ path: { id: session.id } })).data ?? []
      const messages = data.map((item: { info: RawMessage }) => normalizeMessage(item.info))
      const agent = messages.find((message: { role: string; agent?: string }) => message.role === "user")?.agent ?? sessionAgents.get(session.id)
      if (agent) sessionAgents.set(session.id, agent)
      return { id: session.id, parentID: session.parentID, agent, messages }
    }))
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
        flow: runtimeFlow, rootSessionID, sessions, tasks: [...tasks.values()], verification, quality,
        quotas: await quotas(), displacementEfficiency: telemetryOptions.displacementEfficiency ?? options.displacementEfficiency ?? 0.75,
        pricing: normalizePricing(telemetryOptions.apiEquivalentPricing), developerMode,
      }
      const runReport = buildFlowReport({ ...shared, runID: run.id, startedAt: run.startedAt })
      const historical = (await store.listRuns()).filter((item) => item.runID !== runReport.runID || item.rootSessionID !== runReport.rootSessionID)
      const budget = commandCodeBudget([...historical, runReport], options.quota?.commandCodeMonthlyCreditsUsd)
      runReport.quotas = [...runReport.quotas.filter((item) => item.source !== "commandcode-local-budget"), budget]
      await store.writeReport(runReport)
      await store.writeReport(buildFlowReport(shared))
      if (telemetryOptions.runSummaryToast ?? options.usageToast ?? true) await input.client.tui?.showToast({ body: { title: `${flow.title}: run complete`, message: `${runReport.totals.subagentsSpawned} subagents | $${runReport.totals.costUsd.toFixed(4)} metered | $${runReport.totals.apiEquivalentCostUsd.toFixed(4)} API-equivalent`, variant: runReport.totals.taskFailures > 0 ? "warning" : "info", duration: 8_000 } })
    } catch (error) { console.warn("Failed to finalize agent flow telemetry", error) }
  }

  function developerInstructions(sessionID: string): string[] {
    if (!developerMode.enabled) return []
    const run = activeRuns.get(sessionID)
    if (!deterministicSample(`${flow.id}:${run?.id ?? sessionID}:${options.developer?.sampleSalt ?? "default"}`, developerMode.sampleRate)) return ["Developer evaluation mode is enabled, but this run was not selected by its sampling rate."]
    const instructions = ["Developer evaluation mode selected this run. Evaluators must not modify production files."]
    if (developerMode.shadowPlanning) instructions.push("Before implementation, delegate a read-only independent plan to flow-shadow-planner and preserve its <flow-evaluation> JSON marker.")
    if (developerMode.shadowImplementation) instructions.push("Before implementation, request a read-only patch proposal from flow-shadow-implementer and preserve its <flow-evaluation> JSON marker.")
    if (developerMode.auditReview) instructions.push("Before the final answer, delegate a blind audit packet to flow-audit-reviewer and preserve its <flow-evaluation> JSON marker.")
    return instructions
  }

  const developerTool = tool({
    description: "View or update persistent developer evaluation mode without editing opencode.json. Changes apply to the next root request.",
    args: { enabled: tool.schema.boolean().optional(), auditReview: tool.schema.boolean().optional(), shadowPlanning: tool.schema.boolean().optional(), shadowImplementation: tool.schema.boolean().optional(), sampleRate: tool.schema.number().min(0).max(1).optional(), reset: tool.schema.boolean().optional() },
    async execute(args) {
      developerMode = args.reset ? developerDefaults(options) : { ...developerMode, ...Object.fromEntries(Object.entries(args).filter(([key, value]) => key !== "reset" && value !== undefined)) }
      await saveDeveloperMode(developerPath, developerMode)
      return `Developer mode: ${developerMode.enabled ? "enabled" : "disabled"}; audit=${developerMode.auditReview}; shadow plan=${developerMode.shadowPlanning}; shadow implementation=${developerMode.shadowImplementation}; sample rate=${developerMode.sampleRate}. Saved at ${developerPath}; no opencode.json edit or restart is needed.`
    },
  })

  const statusTool = tool({ description: "Show agent-flow telemetry for the latest run, current session, or all recorded runs.", args: { scope: tool.schema.enum(["run", "session", "global"]).default("run") }, async execute(args, context) { if (args.scope === "global") return globalReportMarkdown(await store.global()); const root = await resolveRoot(context.sessionID); if (!root) return "Could not resolve the current root session."; const report = args.scope === "run" ? await store.latestRunForSession(root.id) : await store.session(root.id); return report ? flowReportMarkdown(report) : `No completed ${args.scope} report is available yet.` } })
  const dashboardTool = tool({ description: "Return the cross-client HTML dashboard and report locations for agent-flow telemetry.", args: {}, async execute() { await store.rebuildGlobal(); return `Dashboard: file://${reportDirectory}/dashboard.html\nLatest run: ${reportDirectory}/latest-run.md\nGlobal report: ${reportDirectory}/global.md\nDeveloper controls: flow_developer_mode`; } })
  const feedbackTool = tool({ description: "Record explicit user feedback for the latest completed agent-flow run.", args: { rating: tool.schema.enum(["good", "mixed", "bad"]), note: tool.schema.string().max(2_000).optional() }, async execute(args, context) { const root = await resolveRoot(context.sessionID); if (!root) throw new Error("Could not resolve the current root session"); await store.appendFeedback(root.id, { id: crypto.randomUUID(), sessionID: root.id, source: "feedback", verdict: args.rating, note: args.note, observedAt: Date.now() }); return `Recorded ${args.rating} feedback for the latest completed run.` } })
  const approvalTool = tool({ description: "Request a hard permission prompt before using an approval-gated escalation agent.", args: { agent: tool.schema.string() }, async execute(args, context) { if (!flow.agentMetadata[args.agent]?.requiresApproval && !options.guardrails?.approvalAgents?.includes(args.agent)) return `${args.agent} does not require plugin approval.`; await context.ask({ permission: "flow_escalation", patterns: [args.agent], always: [], metadata: { agent: args.agent, flow: flow.id } }); const root = await resolveRoot(context.sessionID); if (!root) throw new Error("Could not resolve the root session"); const approved = approvals.get(root.id) ?? new Set<string>(); approved.add(args.agent); approvals.set(root.id, approved); return `Approved one use of ${args.agent} for this root session.` } })

  const hooks: any = {
    config: async (config: OpenCodeConfig) => {
      config.agent ??= {}
      for (const [name, definition] of Object.entries(flow.agents)) config.agent[name] ??= definition
      if (baseline) {
        config.agent["flow-audit-reviewer"] ??= evaluatorAgent(baseline, "Blindly audit the completed diff and verification evidence.", "audit-review")
        config.agent["flow-shadow-planner"] ??= evaluatorAgent(baseline, "Create an independent read-only implementation plan.", "shadow-plan")
        config.agent["flow-shadow-implementer"] ??= evaluatorAgent(baseline, "Create a read-only patch proposal without modifying files.", "shadow-implementation")
      }
      if (options.setDefault !== false) config.default_agent ??= flow.defaultAgent
    },
    tool: { flow_status: statusTool, flow_dashboard: dashboardTool, flow_feedback: feedbackTool, flow_approve_escalation: approvalTool, flow_developer_mode: developerTool },
    "chat.message": async (chatInput: { sessionID: string; agent?: string; messageID?: string }, output: { message: RawMessage }) => { if (chatInput.agent) sessionAgents.set(chatInput.sessionID, chatInput.agent); const root = await resolveRoot(chatInput.sessionID); if (!root || root.id !== chatInput.sessionID || chatInput.agent !== flow.defaultAgent) return; activeRuns.set(root.id, { id: chatInput.messageID ?? output.message.id ?? crypto.randomUUID(), rootSessionID: root.id, startedAt: output.message.time?.created ?? Date.now() }) },
    "experimental.chat.system.transform": async (systemInput: { sessionID?: string }, output: { system: string[] }) => { if (!systemInput.sessionID) return; const root = await resolveRoot(systemInput.sessionID); if (root && root.id === systemInput.sessionID) output.system.push(...developerInstructions(root.id)) },
    "tool.execute.before": async (toolInput: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const root = await resolveRoot(toolInput.sessionID); const run = root ? activeRuns.get(root.id) : undefined; const agent = sessionAgents.get(toolInput.sessionID); const role = agent ? metadata[agent]?.role : undefined
      if (role === "evaluator" && ["edit", "write", "apply_patch", "bash", "task"].includes(toolInput.tool)) throw new Error(`Evaluator ${agent} is read-only and cannot use ${toolInput.tool}`)
      if (toolInput.tool === "task") { const delegated = String(output.args.subagent_type ?? output.args.agent ?? "unknown"); const description = typeof output.args.description === "string" ? output.args.description : undefined; const delegatedRole = metadata[delegated]?.role; if (agent === flow.defaultAgent && delegatedRole === "worker") { if ((description?.length ?? 0) > MAX_WORK_PACKET_CHARS) throw new Error(`routine work packet exceeds the ${MAX_WORK_PACKET_CHARS}-character surface-level planning budget`); if (!description?.includes("## Worker Execution Contract")) output.args.description = `${description}${WORK_REPORT_CONTRACT}` }; if (agent === flow.defaultAgent && delegated === "deep") { const routineBlocked = [...tasks.values()].some((task) => task.runID === run?.id && task.agent === "routine" && (task.status === "failed" || task.workReport?.status === "blocked")); if (!routineBlocked) throw new Error("deep requires a failed or blocked routine attempt in the current run"); if (!description?.includes("## Worker Execution Contract")) output.args.description = `${description}${WORK_REPORT_CONTRACT}` }; const packetDescription = typeof output.args.description === "string" ? output.args.description : description; if (run && (delegatedRole === "worker" || delegatedRole === "bulk-worker")) { const key = `${run.id}:${delegated}:${packetDescription ?? "unknown"}`; const attempt = taskAttempts.get(key) ?? 0; const maximum = options.verification?.maxWorkerAttempts ?? flow.verification.maxWorkerAttempts; if (attempt >= maximum) throw new Error(`${delegated} reached the ${maximum}-attempt limit for this task; escalate or ask the user`); taskAttempts.set(key, attempt + 1) }; if (flow.agentMetadata[delegated]?.requiresApproval && !approvals.get(root?.id ?? "")?.delete(delegated)) throw new Error(`${delegated} requires flow_approve_escalation before delegation`); tasks.set(toolInput.callID, { id: crypto.randomUUID(), callID: toolInput.callID, sessionID: toolInput.sessionID, runID: run?.id, agent: delegated, description: packetDescription, status: "running", startedAt: Date.now(), linkConfidence: "correlated" }) }
      if ((options.guardrails?.enabled ?? true) && (role === "worker" || role === "bulk-worker")) { const matched = pathProtected(output.args, options.guardrails?.protectedPaths ?? DEFAULT_PROTECTED_PATHS); if (matched) throw new Error(`Protected path policy blocked ${agent}: matched ${matched}`) }
      if (toolInput.tool === "bash") { const command = String(output.args.command ?? ""); const category = verificationCategory(command); if (category) verification.push({ id: toolInput.callID, runID: run?.id, sessionID: toolInput.sessionID, command: command.slice(0, 1_000), category, status: "unknown", observedAt: Date.now() }) }
    },
    "tool.execute.after": async (toolInput: { callID: string }, output: { output: string; metadata?: Record<string, unknown> }) => { const task = tasks.get(toolInput.callID); if (task) { if (task.status !== "failed") task.status = "completed"; task.completedAt = Date.now(); if (metadata[task.agent ?? ""]?.role === "worker" || task.agent === "deep") { const result = parseWorkReport(output.output); if (result.report) task.workReport = result.report; else { task.workReportError = result.error; output.output += `\n\n[Flow guardrail: this worker result is incomplete because ${result.error}. Request a corrected work report before accepting or escalating the result.]` } }; const evidence = parseEvaluation(output.output, task.runID, task.sessionID); if (evidence) quality.push(evidence) }; const check = verification.find((item) => item.id === toolInput.callID); if (check) { if (check.status !== "failed") check.status = "passed"; if (typeof output.metadata?.duration === "number") check.durationMs = output.metadata.duration } },
    event: async ({ event }: any) => { const part = event.properties?.part; if (event.type === "message.part.updated" && part?.type === "tool" && part.callID && part.state?.status === "error") { const task = tasks.get(part.callID); if (task) { task.status = "failed"; task.completedAt = part.state.time?.end ?? Date.now() }; const check = verification.find((item) => item.id === part.callID); if (check) check.status = "failed" }; const idle = event.type === "session.idle" || (event.type === "session.status" && event.properties?.status?.type === "idle"); if (!idle || !event.properties?.sessionID) return; const root = await resolveRoot(event.properties.sessionID); if (root && root.id === event.properties.sessionID) await finalizeRun(root.id) },
  }
  return hooks
}
