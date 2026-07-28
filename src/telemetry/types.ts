export interface TokenRates {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
export interface ConfigTokenPrice {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export type ModelPricing = Record<string, TokenRates>

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface MessageUsage {
  id?: string
  role: "user" | "assistant"
  createdAt?: number
  completedAt?: number
  agent?: string
  providerID?: string
  modelID?: string
  variant?: string
  costUsd?: number
  tokens?: TokenUsage
  error?: boolean
}

export interface SessionSnapshot {
  id: string
  parentID?: string
  agent?: string
  messages: MessageUsage[]
}

export interface ModelUsage {
  providerID: string
  modelID: string
  agents: string[]
  billingSources: string[]
  assistantMessages: number
  /** @deprecated Use assistantMessages. */
  calls: number
  errors: number
  costUsd: number
  apiEquivalentCostUsd: number
  apiEquivalentPricedCalls: number
  apiEquivalentUnpricedCalls: number
  workloadUnits: number
  tokens: TokenUsage
}

export interface AgentUsage {
  agent: string
  role: string
  billingSource: string
  modelID: string
  sessions: number
  assistantMessages: number
  /** @deprecated Use assistantMessages. */
  calls: number
  costUsd: number
  apiEquivalentCostUsd: number
  apiEquivalentPricedCalls: number
  apiEquivalentUnpricedCalls: number
  workloadUnits: number
}

export interface TaskTrace {
  id: string
  callID: string
  sessionID: string
  runID?: string
  taskID?: string
  agent?: string
  description?: string
  model?: string
  status: "running" | "completed" | "blocked" | "failed" | "invalid-output"
  executionClass?: ExecutionClass
  expectedScope?: string[]
  workReport?: WorkReport
  workReportError?: string
  reviewReport?: ReviewReport
  reviewReportError?: string
  error?: string
  workspace?: string
  startedAt: number
  completedAt?: number
  linkConfidence: "explicit" | "correlated" | "unlinked"
}

export type ExecutionClass = "read-only" | "shared-write" | "integration"

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low"
  title: string
  evidence: string
  file?: string
  line?: number
  verification?: string
}

export interface ReviewReport {
  verdict: "pass" | "changes-requested" | "blocked"
  summary: string
  findings: ReviewFinding[]
}

export interface WorkReport {
  status: "completed" | "blocked"
  summary: string
  filesChanged: string[]
  verification: Array<{ command: string; status: "passed" | "failed" | "not-run" }>
  scopeChanges: string[]
  blocker?: string
}

export interface VerificationEvidence {
  id: string
  runID?: string
  sessionID: string
  command: string
  category: "test" | "typecheck" | "lint" | "build" | "http" | "other"
  status: "passed" | "failed" | "unknown"
  durationMs?: number
  observedAt: number
}

export interface QualityEvidence {
  id: string
  runID?: string
  sessionID?: string
  source: "feedback" | "cheap-review" | "audit-review" | "shadow-plan" | "shadow-implementation"
  verdict: "good" | "mixed" | "bad" | "unknown"
  score?: number
  note?: string
  model?: string
  costUsd?: number
  observedAt: number
}

export interface QuotaWindow {
  usedPercent: number
  windowDurationMins?: number
  resetsAt?: number
}

export interface QuotaSnapshot {
  source: string
  status: "available" | "unavailable" | "error" | "stale"
  capturedAt: number
  planType?: string
  primary?: QuotaWindow
  secondary?: QuotaWindow
  spentUsd?: number
  allowanceUsd?: number
  error?: string
}

export interface ReportTotals {
  assistantMessages: number
  /** @deprecated Use assistantMessages. */
  calls: number
  errors: number
  subagentsSpawned: number
  tasksStarted: number
  tasksCompleted: number
  taskFailures: number
  taskInvalidOutputs: number
  verificationRuns: number
  verificationFailures: number
  retries: number
  readOnlyTasks: number
  sharedWriteTasks: number
  integrationTasks: number
  frontierOverlaps: number
  costUsd: number
  evaluatorCostUsd: number
  apiEquivalentCostUsd: number
  evaluatorApiEquivalentCostUsd: number
  apiEquivalentPricedCalls: number
  apiEquivalentUnpricedCalls: number
  workloadUnits: number
  tokens: TokenUsage
}

export interface FlowReport {
  schemaVersion: 5
  scope: "run" | "session"
  generatedAt: string
  flowID: string
  flowTitle: string
  rootSessionID: string
  runID?: string
  startedAt?: number
  completedAt: number
  durationMs?: number
  totals: ReportTotals
  byModel: ModelUsage[]
  byAgent: AgentUsage[]
  tasks: TaskTrace[]
  verification: VerificationEvidence[]
  quality: QualityEvidence[]
  quotas: QuotaSnapshot[]
  pricingSource: Record<string, TokenRates>
  developerMode?: DeveloperModeSnapshot
  estimate: {
    observedBaselineOffloadPct: number
    estimatedBaselineUsageReductionPct: number
    estimatedCapacityMultiplier: number
    displacementEfficiency: number
    baselineAgent: string
    baselineBillingSource: string
    assumption: string
  }
  confidence: {
    taskLinking: "exact" | "mixed" | "unavailable"
    quota: "provider-reported" | "estimated" | "unavailable"
    quality: "measured" | "sampled" | "unavailable"
  }
}

export interface DeveloperModeSnapshot {
  enabled: boolean
  auditReview: boolean
  shadowPlanning: boolean
  shadowImplementation: boolean
  sampleRate: number
}

export interface GlobalReport {
  schemaVersion: 2
  generatedAt: string
  runs: number
  flows: string[]
  totals: ReportTotals
  averageEstimatedUsageReductionPct: number
  averageCapacityMultiplier: number
  averageDurationMs?: number
  feedback: Record<string, number>
  latestQuotas: QuotaSnapshot[]
}
