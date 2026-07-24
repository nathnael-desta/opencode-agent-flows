import {
  BILLING_SOURCES,
  ORCHESTRATION_CONFIG_VERSION,
  normalizeOrchestrationConfig,
  type BillingSource,
  type OrchestrationConfig,
  type OrchestrationRole,
} from "./config.js"

/** Roles the setup flows ask about; the rest inherit. */
export const CONFIGURABLE_ROLES: OrchestrationRole[] = ["orchestrator", "bulk", "routine", "reviewer", "deep"]

export const ROLE_HELP: Record<string, string> = {
  orchestrator: "Routes and delegates every turn. Wants strong reasoning at low effective cost.",
  bulk: "Repetitive, low-risk, token-heavy work. Wants the cheapest capable model.",
  routine: "The default worker for bounded implementation. Wants balance.",
  reviewer: "Independent milestone review. Prefer a different model family from routine.",
  deep: "Evidence-backed escalation after routine fails. Wants the strongest model.",
}

const MODEL_PATTERN = /^[^/\s]+\/\S+$/

export function isModelReference(value: string): boolean {
  return MODEL_PATTERN.test(value)
}

export function providerOf(model: string): string {
  return model.split("/")[0]
}

/**
 * Interpret an answer to a role prompt: a 1-based index into the ranked list,
 * an explicit provider/model, or blank to inherit. Returning an error rather
 * than silently skipping matters — a typo used to drop a required role and only
 * surface after the whole interview.
 */
export function resolveSelection(answer: string, ranked: Array<{ model: string }>): { model?: string; inherit?: true; error?: string } {
  const trimmed = answer.trim()
  if (!trimmed) return { inherit: true }
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed)
    if (index >= 1 && index <= ranked.length) return { model: ranked[index - 1].model }
    return { error: `Choose a number between 1 and ${ranked.length}, or type a provider/model value.` }
  }
  if (isModelReference(trimmed)) return { model: trimmed }
  return { error: `"${trimmed}" is not a provider/model value (for example openai/gpt-5.6-sol).` }
}

export function normalizeBillingAnswer(answer: string): BillingSource | undefined {
  const trimmed = answer.trim()
  if (!trimmed) return "metered"
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed)
    return index >= 1 && index <= BILLING_SOURCES.length ? BILLING_SOURCES[index - 1] : undefined
  }
  return (BILLING_SOURCES as readonly string[]).includes(trimmed) ? (trimmed as BillingSource) : undefined
}

export interface SetupSelections {
  selections: Partial<Record<OrchestrationRole, string>>
  /** Billing source per provider id. */
  billing?: Record<string, BillingSource>
  /** Effective-cost note per provider id. */
  notes?: Record<string, string>
  title?: string
}

/**
 * Turn gathered answers into a validated config. Pure, so both the interactive
 * and non-interactive paths share exactly one code path to the saved file.
 */
export function buildOrchestrationConfig(input: SetupSelections): OrchestrationConfig {
  const roles: Record<string, unknown> = {}
  for (const [role, model] of Object.entries(input.selections)) {
    if (!model) continue
    const provider = providerOf(model)
    const billingSource = input.billing?.[provider] ?? "metered"
    const note = input.notes?.[provider]
    roles[role] = {
      model,
      billingSource,
      ...(note ? { effectiveCostNote: note } : {}),
    }
  }
  return normalizeOrchestrationConfig({
    version: ORCHESTRATION_CONFIG_VERSION,
    ...(input.title ? { title: input.title } : {}),
    roles,
  })
}

/** Which providers still need a billing answer, in first-seen order. */
export function providersNeedingBilling(selections: Partial<Record<OrchestrationRole, string>>): string[] {
  const seen: string[] = []
  for (const model of Object.values(selections)) {
    if (!model) continue
    const provider = providerOf(model)
    if (!seen.includes(provider)) seen.push(provider)
  }
  return seen
}
