export type AgentRole =
  | "orchestrator"
  | "bulk-worker"
  | "worker"
  | "reviewer"
  | "escalation"
  | "evaluator"

export interface AgentDefinition {
  description: string
  mode: "primary" | "subagent" | "all"
  model: string
  variant?: string
  prompt?: string
  steps?: number
  permission?: Record<string, "allow" | "ask" | "deny" | Record<string, "allow" | "ask" | "deny">>
}

export interface AgentMetadata {
  role: AgentRole
  billingSource: string
  risk: "low" | "standard" | "high"
  requiresApproval?: boolean
}

export interface VerificationPolicy {
  enabled: boolean
  discoverFromRepository: boolean
  maxWorkerAttempts: number
  fullSuiteRisk: "standard" | "high"
}

export interface ReviewerPolicy {
  enabled: boolean
  agent: string
  triggers: Array<"explicit" | "milestone" | "high-risk" | "sampled">
  sampleRate: number
  maxRounds: number
  maxFindings: number
  maxPacketChars: number
}

export interface OrchestrationPolicy {
  maxTasksPerRun: number
  maxConcurrentWorkers: number
}

export interface FlowDefinition {
  id: string
  title: string
  summary: string
  defaultAgent: string
  baselineAgent: string
  agents: Record<string, AgentDefinition>
  agentMetadata: Record<string, AgentMetadata>
  routingRules: string[]
  escalationRules: string[]
  verification: VerificationPolicy
  orchestration: OrchestrationPolicy
  reviewer?: ReviewerPolicy
  limitations: string[]
}

export interface OpenCodeConfig {
  default_agent?: string
  agent?: Record<string, AgentDefinition | Record<string, unknown>>
  command?: Record<string, { template: string; description?: string; agent?: string; model?: string; subtask?: boolean }>
}

export interface DeveloperModeOptions {
  enabled?: boolean
  auditReview?: boolean
  shadowPlanning?: boolean
  shadowImplementation?: boolean
  sampleRate?: number
  sampleSalt?: string
}

export interface TelemetryOptions {
  enabled?: boolean
  reportDir?: string
  runSummaryToast?: boolean
  dashboard?: boolean
  retentionDays?: number
  displacementEfficiency?: number
  /** Optional API-equivalent prices in USD per million tokens, keyed by provider/model. */
  apiEquivalentPricing?: Record<string, {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }>
}

export interface VerificationOptions {
  enabled?: boolean
  autoRun?: boolean
  maxWorkerAttempts?: number
  timeoutMs?: number
}

export interface ReviewerOptions {
  enabled?: boolean
  agent?: string
  sampleRate?: number
  maxRounds?: number
  maxFindings?: number
  maxPacketChars?: number
}

export interface OrchestrationOptions {
  maxTasksPerRun?: number
  maxConcurrentWorkers?: number
}

export interface QuotaOptions {
  codex?: boolean
  refreshMs?: number
  commandCodeMonthlyCreditsUsd?: number
}

export interface GuardrailOptions {
  enabled?: boolean
  protectedPaths?: string[]
  approvalAgents?: string[]
}

export interface PluginOptions {
  flow?: string
  setDefault?: boolean
  telemetry?: TelemetryOptions
  developer?: DeveloperModeOptions
  verification?: VerificationOptions
  reviewer?: ReviewerOptions
  orchestration?: OrchestrationOptions
  quota?: QuotaOptions
  guardrails?: GuardrailOptions

  // Deprecated flat options retained for the initial local release.
  usageTracking?: boolean
  usageReportDir?: string
  usageToast?: boolean
  displacementEfficiency?: number
}
