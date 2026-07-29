import type { FlowDefinition } from "../types.js"
import type { TokenRates } from "./types.js"
import { computeApiEquivalentCost, lookupRate } from "./pricing.js"
import type {
  AgentUsage,
  AntigravityTrace,
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
  assistantMessages: 0,
  calls: 0,
  errors: 0,
  subagentsSpawned: 0,
  tasksStarted: 0,
  tasksCompleted: 0,
  taskFailures: 0,
  taskInvalidOutputs: 0,
  verificationRuns: 0,
  verificationFailures: 0,
  retries: 0,
  readOnlyTasks: 0,
  sharedWriteTasks: 0,
  integrationTasks: 0,
  frontierOverlaps: 0,
  costUsd: 0,
  evaluatorCostUsd: 0,
  apiEquivalentCostUsd: 0,
  evaluatorApiEquivalentCostUsd: 0,
  apiEquivalentPricedCalls: 0,
  apiEquivalentUnpricedCalls: 0,
  workloadUnits: 0,
  tokens: emptyTokens(),
  antigravityCalls: 0,
  antigravityForeground: 0,
  antigravityBackground: 0,
  antigravityVision: 0,
})

function addTokens(target: TokenUsage, source: TokenUsage): void {
  target.input += source.input
  target.output += source.output
  target.reasoning += source.reasoning
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
}

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
  developerMode?: FlowReport["developerMode"]
  antigravityCalls?: AntigravityTrace[]
}

export function buildFlowReport(input: BuildReportInput): FlowReport {
  const completedAt = Date.now()
  const models = new Map<string, ModelUsage>()
  const agents = new Map<string, AgentUsage>()
  const totals = emptyTotals()
  const displacementEfficiency = input.displacementEfficiency ?? 0.75
  const baselineMetadata = input.flow.agentMetadata[input.flow.baselineAgent]
  const baselineSrc = baselineMetadata?.["billingSource"] ?? "unknown"
  const pricing = input.pricing ?? {}
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
      modelID: "unknown",
      sessions: 0,
      assistantMessages: 0,
      calls: 0,
      costUsd: 0,
      apiEquivalentCostUsd: 0,
      apiEquivalentPricedCalls: 0,
      apiEquivalentUnpricedCalls: 0,
      workloadUnits: 0,
    }
    agent.sessions += 1

    for (const message of session.messages) {
      if (
        message.role !== "assistant" ||
        !message.providerID ||
        !message.modelID ||
        (!message.tokens && !message.error) ||
        !messageInWindow(message, input.startedAt)
      ) continue

      const messageTokens = message.tokens ?? emptyTokens()
      const units = workloadUnits(messageTokens)
      const evaluator = role === "evaluator"
      const modelKey = message.providerID + "/" + message.modelID
      const rates = lookupRate(modelKey, pricing)
      const apiCost = rates ? computeApiEquivalentCost(messageTokens, rates) : 0

      if (message.modelID) agent.modelID = modelKey

      totals.assistantMessages += 1
      totals.calls += 1
      totals.errors += message.error ? 1 : 0
      totals.costUsd += message.costUsd ?? 0
      totals.apiEquivalentCostUsd += apiCost
      if (rates) totals.apiEquivalentPricedCalls += 1
      else totals.apiEquivalentUnpricedCalls += 1
      if (evaluator) {
        totals.evaluatorCostUsd += message.costUsd ?? 0
        totals.evaluatorApiEquivalentCostUsd += apiCost
      }
      totals.workloadUnits += units
      addTokens(totals.tokens, messageTokens)

      agent.assistantMessages += 1
      agent.calls += 1
      agent.costUsd += message.costUsd ?? 0
      agent.apiEquivalentCostUsd += apiCost
      if (rates) agent.apiEquivalentPricedCalls += 1
      else agent.apiEquivalentUnpricedCalls += 1
      agent.workloadUnits += units

      if (!evaluator && billingSource !== baselineSrc) displacedUnits += units

      const key = message.providerID + "/" + message.modelID
      const model = models.get(key) ?? {
        providerID: message.providerID,
        modelID: message.modelID,
        agents: [],
        billingSources: [],
        assistantMessages: 0,
        calls: 0,
        errors: 0,
        costUsd: 0,
        apiEquivalentCostUsd: 0,
        apiEquivalentPricedCalls: 0,
        apiEquivalentUnpricedCalls: 0,
        workloadUnits: 0,
        tokens: emptyTokens(),
      }
      if (!model.agents.includes(agentName)) model.agents.push(agentName)
      if (!model.billingSources.includes(billingSource)) model.billingSources.push(billingSource)
      model.assistantMessages += 1
      model.calls += 1
      model.errors += message.error ? 1 : 0
      model.costUsd += message.costUsd ?? 0
      model.apiEquivalentCostUsd += apiCost
      if (rates) model.apiEquivalentPricedCalls += 1
      else model.apiEquivalentUnpricedCalls += 1
      model.workloadUnits += units
      addTokens(model.tokens, messageTokens)
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
  totals.taskInvalidOutputs = tasks.filter((task) => task.status === "invalid-output").length
  // invalid-output is counted separately in taskInvalidOutputs. Folding it in
  // here too double-counts it and raises a warning toast for a worker that did
  // the job but mis-formatted its report marker.
  totals.taskFailures = tasks.filter((task) => ["failed", "blocked"].includes(task.status)).length
  totals.verificationRuns = verification.length
  totals.verificationFailures = verification.filter((item) => item.status === "failed").length
  totals.retries = Math.max(0, tasks.length - new Set(tasks.map((task) => (task.agent ?? "unknown") + ":" + (task.taskID ?? task.description ?? task.id))).size)

  const completedWorkerTasks = tasks.filter(
    (task) => task.executionClass !== undefined && task.status !== "running",
  )
  totals.readOnlyTasks = completedWorkerTasks.filter((task) => task.executionClass === "read-only").length
  totals.sharedWriteTasks = completedWorkerTasks.filter((task) => task.executionClass === "shared-write").length
  totals.integrationTasks = completedWorkerTasks.filter((task) => task.executionClass === "integration").length

  const completedWithFiles = tasks.filter(
    (task) => task.workReport?.filesChanged && task.workReport.filesChanged.length > 0 && task.startedAt > 0 && task.completedAt !== undefined && task.completedAt > task.startedAt,
  )
  for (let i = 0; i < completedWithFiles.length; i++) {
    for (let j = i + 1; j < completedWithFiles.length; j++) {
      const a = completedWithFiles[i]
      const b = completedWithFiles[j]
      const overlap = a.startedAt < b.completedAt! && b.startedAt < a.completedAt!
      if (!overlap) continue
      const shared = a.workReport!.filesChanged.filter((file) => b.workReport!.filesChanged.includes(file))
      if (shared.length > 0) totals.frontierOverlaps += 1
    }
  }

  const productionUnits = Math.max(0, totals.workloadUnits - [...agents.values()]
    .filter((agent) => agent.role === "evaluator")
    .reduce((sum, agent) => sum + agent.workloadUnits, 0))
  const observedOffload = productionUnits === 0 ? 0 : displacedUnits / productionUnits
  const estimatedReduction = Math.min(observedOffload * displacementEfficiency, 0.95)
  const taskConfidences = new Set(tasks.map((task) => task.linkConfidence))
  const quotaSnapshots = input.quotas ?? []
  const antigravityCalls = (input.antigravityCalls ?? []).filter((call) =>
    includedSessionIDs.has(call.sessionID) && (!input.runID || call.runID === input.runID),
  )
  totals.antigravityCalls = antigravityCalls.length
  totals.antigravityForeground = antigravityCalls.filter((c) => c.type === "foreground").length
  totals.antigravityBackground = antigravityCalls.filter((c) => c.type === "background").length
  totals.antigravityVision = antigravityCalls.filter((c) => c.type === "vision").length

  return {
    schemaVersion: 6,
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
      apiEquivalentCostUsd: round(totals.apiEquivalentCostUsd, 6),
      evaluatorApiEquivalentCostUsd: round(totals.evaluatorApiEquivalentCostUsd, 6),
      workloadUnits: round(totals.workloadUnits),
    },
    byModel: [...models.values()].map((model) => ({
      ...model,
      agents: model.agents.sort(),
      billingSources: model.billingSources.sort(),
      costUsd: round(model.costUsd, 6),
      apiEquivalentCostUsd: round(model.apiEquivalentCostUsd, 6),
      workloadUnits: round(model.workloadUnits),
    })).sort((a, b) => b.workloadUnits - a.workloadUnits),
    byAgent: [...agents.values()].map((agent) => ({
      ...agent,
      costUsd: round(agent.costUsd, 6),
      apiEquivalentCostUsd: round(agent.apiEquivalentCostUsd, 6),
      workloadUnits: round(agent.workloadUnits),
    })).sort((a, b) => b.workloadUnits - a.workloadUnits),
    tasks,
    verification,
    quality,
    quotas: quotaSnapshots,
    pricingSource: pricing,
    developerMode: input.developerMode,
    antigravityCalls,
    estimate: {
      observedBaselineOffloadPct: round(observedOffload * 100),
      estimatedBaselineUsageReductionPct: round(estimatedReduction * 100),
      estimatedCapacityMultiplier: round(1 / (1 - estimatedReduction)),
      displacementEfficiency,
      baselineAgent: input.flow.baselineAgent,
      baselineBillingSource: baselineSrc,
      assumption:
        "Non-baseline billing workload displaces baseline workload at the configured efficiency. API-equivalent cost is calculated only for calls with configured token prices, including subscription-backed calls.",
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
    "assistantMessages", "calls", "errors", "subagentsSpawned", "tasksStarted", "tasksCompleted", "taskFailures", "taskInvalidOutputs",
    "verificationRuns", "verificationFailures", "retries", "readOnlyTasks", "sharedWriteTasks", "integrationTasks", "frontierOverlaps",
    "costUsd", "evaluatorCostUsd",
    "apiEquivalentCostUsd", "evaluatorApiEquivalentCostUsd", "apiEquivalentPricedCalls", "apiEquivalentUnpricedCalls", "workloadUnits",
    "antigravityCalls", "antigravityForeground", "antigravityBackground", "antigravityVision",
  ] as const) target[key] += source[key] ?? (key === "assistantMessages" ? source.calls : 0)
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
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runs: reports.length,
    flows: [...new Set(reports.map((report) => report.flowID))].sort(),
    totals: {
      ...totals,
      costUsd: round(totals.costUsd, 6),
      evaluatorCostUsd: round(totals.evaluatorCostUsd, 6),
      apiEquivalentCostUsd: round(totals.apiEquivalentCostUsd, 6),
      evaluatorApiEquivalentCostUsd: round(totals.evaluatorApiEquivalentCostUsd, 6),
    },
    averageEstimatedUsageReductionPct: round(reports.reduce((sum, report) => sum + report.estimate.estimatedBaselineUsageReductionPct, 0) / count),
    averageCapacityMultiplier: round(reports.reduce((sum, report) => sum + report.estimate.estimatedCapacityMultiplier, 0) / count),
    averageDurationMs: timedRuns.length === 0
      ? undefined
      : round(timedRuns.reduce((sum, report) => sum + (report.durationMs ?? 0), 0) / timedRuns.length),
    feedback,
    latestQuotas,
  }
}
