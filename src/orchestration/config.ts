import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * How a model's cost actually reaches the user, which is usually not its paper
 * per-token price. Recommendations rank on effective cost, not paper price.
 */
export type BillingSource =
  | "metered" // paper per-token price on a raw API key
  | "subscription-flat" // ~$0 marginal within a flat subscription's capacity
  | "credit-pool" // paper price drawn against a fixed monthly credit balance
  | "bundled-credit" // discounted/free via a bundle already paid for elsewhere
  | "unknown"

export const BILLING_SOURCES: readonly BillingSource[] = [
  "metered",
  "subscription-flat",
  "credit-pool",
  "bundled-credit",
  "unknown",
]

/** The stable orchestration roles a generated flow can bind models to. */
export type OrchestrationRole =
  | "orchestrator"
  | "bulk"
  | "routine"
  | "reviewer"
  | "deep"
  | "extreme-medium"
  | "extreme-high"

export const ORCHESTRATION_ROLES: readonly OrchestrationRole[] = [
  "orchestrator",
  "bulk",
  "routine",
  "reviewer",
  "deep",
  "extreme-medium",
  "extreme-high",
]

export interface RoleBinding {
  /** provider/model, for example openai/gpt-5.6-sol */
  model: string
  variant?: string
  billingSource?: BillingSource
  /** Free-form note explaining the effective cost, shown in the config view. */
  effectiveCostNote?: string
}

export interface OrchestrationConfig {
  version: number
  title?: string
  /** orchestrator and routine are required; other roles fall back to them. */
  roles: Partial<Record<OrchestrationRole, RoleBinding>> & {
    orchestrator: RoleBinding
    routine: RoleBinding
  }
  orchestration?: {
    maxTasksPerRun?: number
    maxConcurrentWorkers?: number
  }
  reviewer?: {
    enabled?: boolean
    maxRounds?: number
    maxFindings?: number
    sampleRate?: number
    maxPacketChars?: number
  }
}

export const ORCHESTRATION_CONFIG_VERSION = 1

/**
 * provider/model, where the model half may itself contain slashes. Aggregators
 * such as openrouter, groq, and nvidia namespace their models
 * (openrouter/anthropic/claude-sonnet-4), and those are over half of the
 * models.dev catalog, so requiring exactly one slash rejects most real ids.
 */
const MODEL_PATTERN = /^[^/\s]+\/\S+$/

/** Clamp a configured budget to a sane integer range. */
function clampInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.round(value)))
}

function clampRate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

function normalizeBillingSource(value: unknown): BillingSource | undefined {
  if (typeof value !== "string") return undefined
  return (BILLING_SOURCES as readonly string[]).includes(value) ? (value as BillingSource) : "unknown"
}

function normalizeRoleBinding(value: unknown, role: string): RoleBinding {
  if (typeof value !== "object" || value === null) throw new Error(`Role ${role} must be an object with a model`)
  const record = value as Record<string, unknown>
  if (typeof record.model !== "string" || !MODEL_PATTERN.test(record.model))
    throw new Error(`Role ${role} needs a provider/model string, for example openai/gpt-5.6-sol`)
  const binding: RoleBinding = { model: record.model }
  if (typeof record.variant === "string") binding.variant = record.variant
  const billingSource = normalizeBillingSource(record.billingSource)
  if (billingSource) binding.billingSource = billingSource
  if (typeof record.effectiveCostNote === "string") binding.effectiveCostNote = record.effectiveCostNote
  return binding
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Validate and normalize an untrusted config object, throwing on hard errors. */
export function normalizeOrchestrationConfig(raw: unknown): OrchestrationConfig {
  if (typeof raw !== "object" || raw === null) throw new Error("Orchestration config must be a JSON object")
  const record = raw as Record<string, unknown>
  const rolesInput = record.roles
  if (typeof rolesInput !== "object" || rolesInput === null) throw new Error("Orchestration config requires a roles object")
  const rolesRecord = rolesInput as Record<string, unknown>
  if (!rolesRecord.orchestrator) throw new Error("Orchestration config requires an orchestrator role")
  if (!rolesRecord.routine) throw new Error("Orchestration config requires a routine role")

  const roles: OrchestrationConfig["roles"] = {
    orchestrator: normalizeRoleBinding(rolesRecord.orchestrator, "orchestrator"),
    routine: normalizeRoleBinding(rolesRecord.routine, "routine"),
  }
  for (const role of ORCHESTRATION_ROLES) {
    if (role === "orchestrator" || role === "routine") continue
    if (rolesRecord[role] !== undefined) roles[role] = normalizeRoleBinding(rolesRecord[role], role)
  }

  const config: OrchestrationConfig = {
    version: optionalNumber(record.version) ?? ORCHESTRATION_CONFIG_VERSION,
    roles,
  }
  if (typeof record.title === "string") config.title = record.title

  // Budgets are clamped, not trusted. Left unbounded, a config could remove the
  // concurrency limit or set maxRounds/maxPacketChars to values that make every
  // reviewer delegation throw, silently disabling the review gate.
  const orchestration = record.orchestration as Record<string, unknown> | undefined
  if (orchestration) {
    const maxTasksPerRun = clampInteger(orchestration.maxTasksPerRun, 1, 50)
    const maxConcurrentWorkers = clampInteger(orchestration.maxConcurrentWorkers, 1, 8)
    config.orchestration = {
      ...(maxTasksPerRun !== undefined ? { maxTasksPerRun } : {}),
      ...(maxConcurrentWorkers !== undefined ? { maxConcurrentWorkers } : {}),
    }
  }

  const reviewer = record.reviewer as Record<string, unknown> | undefined
  if (reviewer) {
    const maxRounds = clampInteger(reviewer.maxRounds, 1, 3)
    const maxFindings = clampInteger(reviewer.maxFindings, 1, 20)
    const sampleRate = clampRate(reviewer.sampleRate)
    const maxPacketChars = clampInteger(reviewer.maxPacketChars, 1_000, 50_000)
    config.reviewer = {
      ...(typeof reviewer.enabled === "boolean" ? { enabled: reviewer.enabled } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      ...(maxFindings !== undefined ? { maxFindings } : {}),
      ...(sampleRate !== undefined ? { sampleRate } : {}),
      ...(maxPacketChars !== undefined ? { maxPacketChars } : {}),
    }
  }

  return config
}

/** Load the persisted generated flow, throwing a setup-oriented error if absent. */
export async function loadOrchestrationConfig(path: string): Promise<OrchestrationConfig> {
  let contents: string
  try {
    contents = await readFile(path, "utf8")
  } catch {
    throw new Error(
      `No orchestration config found at ${path}. Run the setup skill (or flow_configure) to generate one, then set { "flow": "custom" }.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Orchestration config at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return normalizeOrchestrationConfig(parsed)
}

export async function saveOrchestrationConfig(path: string, config: OrchestrationConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  await rename(temporary, path)
}
