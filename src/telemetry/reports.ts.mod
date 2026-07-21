import type { FlowDefinition } from "../types.js"
import type { TokenRates } from "./types.js"
import type {
  AgentUsage,
  FlowReport,
  GlobalReport,
  MessageUsage,
  ModelUsage,
  QualityEvidence,
  QuotaSnapshot,
  ReportTotals,
  SessionSnapshot,
  TaskTrace,
  TokenUsage,
  VerificationEvidence,
} from "./types.js"

const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })

const emptyTotals = (): ReportTotals => ({
  calls: 0,
  errors: 0,
  subagentsSpawned: 0,
  tasksStarted: 0,
  tasksCompleted: 0,
  taskFailures: 0,
  verificationRuns: 0,
  verificationFailures: 0,
  retries: 0,
  costUsd: 0,
  evaluatorCostUsd: 0,
  workloadUnits: 0,
  tokens: emptyTokens(),
})

function addTokens(target: TokenUsage, source: TokenUsage): void {
  target.input += source.input
  target.output += source.output
  target.reasoning += source.reasoning
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
}

// Generic compute weights make unlike token types comparable without assuming a provider's prices.
export function workloadUnits(tokens: TokenUsage): number {
  return (
    tokens.input +
    (tokens.output + tokens.reasoning) * 4 +
    tokens.cacheRead * 0.1 +
    tokens.cacheWrite * 1.25
  )
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}


export function computeApiEquivalentCost(tokens, rates) {
  return (
    (tokens.input / 1_000_000) * rates.input +
    ((tokens.output + tokens.reasoning) / 1_000_000) * rates.output +
    (tokens.cacheRead / 1_000_000) * rates.cacheRead +
    (tokens.cacheWrite / 1_000_000) * rates.cacheWrite
  )
}

function lookupRate(modelKey, pricing) {
  const exact = pricing[modelKey]
  if (exact) return exact
  const slash = modelKey.indexOf("/")
  if (slash === -1) return undefined
  const provider = modelKey.slice(0, slash)
  const wild = provider + "/*"
  if (pricing[wild]) return pricing[wild]
  return undefined
}
function messageInWindow(message: MessageUsage, startedAt?: number): boolean {
  return startedAt === undefined || (message.createdAt ?? 0) >= startedAt
}

export interface BuildReportInput {
  flow: FlowDefinition
  rootSessionID: string
  runID?: string
  startedAt?: number
  sessions: SessionSnapshot[]
  tasks?: TaskTrace[]
  verification?: VerificationEvidence[]
  quality?: QualityEvidence[]
  quotas?: QuotaSnapshot[]
  displacementEfficiency?: number
  pricing?: Record<string, TokenRates>
  subSources?: string[]
}

export function buildFlowReport(input: BuildReportInput): FlowReport {
  const completedAt = Date.now()
  const models = new Map<string, ModelUsage>()
  const agents = new Map<string, AgentUsage>()
  const totals = emptyTotals()
  const displacementEfficiency = input.displacementEfficiency ?? 0.75
  const baselineMetadata = input.flow.agentMetadata[input.flow.baselineAgent]
  const baselineBillingSource = baselineMetadata?.billingSource ?? "unknown"
  let displacedUnits = 0

  const includedSessions = input.sessions.filter((session) =>
    session.messages.some((message) => messageInWindow(message, input.startedAt)),
  )
  const includedSessionIDs = new Set(includedSessions.map((session) => session.id))
  totals.subagentsSpawned = includedSessions.filter((session) => session.parentID).length

  for (const session of includedSessions) {
    const agentName = session.agent ?? "unknown"
    const metadata = input.flow.agentMetadata[agentName]
    const role = metadata?.role ?? (session.parentID ? "worker" : "orchestrator")
    const billingSource = metadata?.billingSource ?? "unknown"
    const agent = agents.get(agentName) ?? {
      agent: agentName,
      role,
      billingSource,
      sessions: 0,
      calls: 0,
      costUsd: 0,
      workloadUnits: 0,
    }
    agent.sessions += 1

    for (const message of session.messages) {
      if (
        message.role !== "assistant" ||
        !message.providerID ||
        !message.modelID ||
        !message.tokens ||
        !messageInWindow(message, input.startedAt)
      ) continue

      const units = workloadUnits(message.tokens)
      const evaluator = role === "evaluator"
      totals.calls += 1
      totals.errors += message.error ? 1 : 0
      totals.costUsd += message.costUsd ?? 0
      totals.workloadUnits += units
      if (evaluator) totals.evaluatorCostUsd += message.costUsd ?? 0
      addTokens(totals.tokens, message.tokens)

      agent.calls += 1
      agent.costUsd += message.costUsd ?? 0
      agent.workloadUnits += units

      if (!evaluator && billingSource !== baselineBillingSource) displacedUnits += units

      const key = `${message.providerID}/${message.modelID}`
      const model = models.get(key) ?? {
        providerID: message.providerID,
        modelID: message.modelID,
        agents: [],
        billingSources: [],
        calls: 0,
        errors: 0,
        costUsd: 0,
        workloadUnits: 0,
        tokens: emptyTokens(),
      }
      if (!model.agents.includes(agentName)) model.agents.push(agentName)
      if (!model.billingSources.includes(billingSource)) model.billingSources.push(billingSource)
      model.calls += 1
      model.errors += message.error ? 1 : 0
      model.costUsd += message.costUsd ?? 0
      model.workloadUnits += units
      addTokens(model.tokens, message.tokens)
      models.set(key, model)
    }
    agents.set(agentName, agent)
  }

  const tasks = (input.tasks ?? []).filter((task) =>
    includedSessionIDs.has(task.sessionID) && (!input.runID || task.runID === input.runID),
  )
  const verification = (input.verification ?? []).filter((evidence) =>
    includedSessionIDs.has(evidence.sessionID) && (!input.runID || evidence.runID === input.runID),
  )
  const quality = (input.quality ?? []).filter((evidence) =>
    (!evidence.sessionID || includedSessionIDs.has(evidence.sessionID)) &&
    (!input.runID || evidence.runID === input.runID),
  )
  totals.tasksStarted = tasks.length
  totals.tasksCompleted = tasks.filter((task) => task.status === "completed").length
  totals.taskFailures = tasks.filter((task) => task.status === "failed").length
  totals.verificationRuns = verification.length
  totals.verificationFailures = verification.filter((item) => item.status === "failed").length
  totals.retries = Math.max(0, tasks.length - new Set(tasks.map((task) => `${task.agent ?? "unknown"}:${task.description ?? task.id}`)).size)

  const productionUnits = Math.max(0, totals.workloadUnits - [...agents.values()]
    .filter((agent) => agent.role === "evaluator")
    .reduce((sum, agent) => sum + agent.workloadUnits, 0))
  const observedOffload = productionUnits === 0 ? 0 : displacedUnits / productionUnits
  const estimatedReduction = Math.min(observedOffload * displacementEfficiency, 0.95)
  const taskConfidences = new Set(tasks.map((task) => task.linkConfidence))
  const quotaSnapshots = input.quotas ?? []

  return {
    schemaVersion: 2,
    scope: input.runID ? "run" : "session",
    generatedAt: new Date().toISOString(),
    flowID: input.flow.id,
    flowTitle: input.flow.title,
    rootSessionID: input.rootSessionID,
    runID: input.runID,
    startedAt: input.startedAt,
    completedAt,
    durationMs: input.startedAt === undefined ? undefined : Math.max(0, completedAt - input.startedAt),
    totals: {
      ...totals,
      costUsd: round(totals.costUsd, 6),
      evaluatorCostUsd: round(totals.evaluatorCostUsd, 6),
      workloadUnits: round(totals.workloadUnits),
    },
    byModel: [...models.values()].map((model) => ({
      ...model,
      agents: model.agents.sort(),
      billingSources: model.billingSources.sort(),
      costUsd: round(model.costUsd, 6),
      workloadUnits: round(model.workloadUnits),
    })).sort((a, b) => b.workloadUnits - a.workloadUnits),
    byAgent: [...agents.values()].map((agent) => ({
      ...agent,
      costUsd: round(agent.costUsd, 6),
      workloadUnits: round(agent.workloadUnits),
    })).sort((a, b) => b.workloadUnits - a.workloadUnits),
    tasks,
    verification,
    quality,
    quotas: quotaSnapshots,
    estimate: {
      observedBaselineOffloadPct: round(observedOffload * 100),
      estimatedBaselineUsageReductionPct: round(estimatedReduction * 100),
      estimatedCapacityMultiplier: round(1 / (1 - estimatedReduction)),
      displacementEfficiency,
      baselineAgent: input.flow.baselineAgent,
      baselineBillingSource,
      assumption:
        "Non-baseline billing workload displaces baseline workload at the configured efficiency. Subscription limits are not inferred from tokens.",
    },
    confidence: {
      taskLinking: tasks.length === 0 ? "unavailable" : taskConfidences.size === 1 && taskConfidences.has("explicit") ? "exact" : "mixed",
      quota: quotaSnapshots.some((quota) => quota.status === "available" && quota.source === "codex")
        ? "provider-reported"
        : quotaSnapshots.some((quota) => quota.status === "available") ? "estimated" : "unavailable",
      quality: quality.length === 0 ? "unavailable" : quality.some((item) => item.source === "feedback") ? "measured" : "sampled",
    },
  }
}

function addTotals(target: ReportTotals, source: ReportTotals): void {
  for (const key of [
    "calls", "errors", "subagentsSpawned", "tasksStarted", "tasksCompleted", "taskFailures",
    "verificationRuns", "verificationFailures", "retries", "costUsd", "evaluatorCostUsd", "workloadUnits",
  ] as const) target[key] += source[key]
  addTokens(target.tokens, source.tokens)
}

export function buildGlobalReport(reports: FlowReport[]): GlobalReport {
  const totals = emptyTotals()
  const feedback: Record<string, number> = { good: 0, mixed: 0, bad: 0, unknown: 0 }
  for (const report of reports) {
    addTotals(totals, report.totals)
    for (const evidence of report.quality.filter((item) => item.source === "feedback")) {
      feedback[evidence.verdict] = (feedback[evidence.verdict] ?? 0) + 1
    }
  }
  const count = reports.length || 1
  const timedRuns = reports.filter((report) => report.durationMs !== undefined)
  const latestQuotas = [...reports].reverse().find((report) => report.quotas.length > 0)?.quotas ?? []
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runs: reports.length,
    flows: [...new Set(reports.map((report) => report.flowID))].sort(),
    totals: { ...totals, costUsd: round(totals.costUsd, 6), evaluatorCostUsd: round(totals.evaluatorCostUsd, 6) },
    averageEstimatedUsageReductionPct: round(reports.reduce((sum, report) => sum + report.estimate.estimatedBaselineUsageReductionPct, 0) / count),
    averageCapacityMultiplier: round(reports.reduce((sum, report) => sum + report.estimate.estimatedCapacityMultiplier, 0) / count),
    averageDurationMs: timedRuns.length === 0
      ? undefined
      : round(timedRuns.reduce((sum, report) => sum + (report.durationMs ?? 0), 0) / timedRuns.length),
    feedback,
    latestQuotas,
  }
}
