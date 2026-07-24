import type { BillingSource, OrchestrationRole } from "./config.js"
import { blendedPaperCost, effectiveCost, roleScore } from "./economics.js"
import type { QualityIndex, QualityMatch } from "./quality.js"

export interface DiscoveredModel {
  id: string
  name?: string
  cost?: { input?: number; output?: number }
  limit?: { context?: number }
  reasoning?: boolean
  toolCall?: boolean
}

export interface DiscoveredProvider {
  id: string
  name?: string
  models: DiscoveredModel[]
}

/** models.dev api.json, reduced to the fields discovery needs. */
export type ModelsDevIndex = Record<
  string,
  Record<
    string,
    {
      name?: string
      cost?: { input?: number; output?: number }
      limit?: { context?: number }
      reasoning?: boolean
      tool_call?: boolean
    }
  >
>

export interface ModelCandidate {
  /** provider/model id, ready to drop into a role binding. */
  model: string
  provider: string
  displayName: string
  context?: number
  reasoning?: boolean
  toolCall?: boolean
  inputPerMillion?: number
  outputPerMillion?: number
  blendedPerMillion?: number
  quality?: QualityMatch
}

/** Defensively normalize the OpenCode client `config.providers()` response. */
export function normalizeProviders(raw: unknown): DiscoveredProvider[] {
  const providers = (raw as { providers?: unknown })?.providers ?? raw
  if (!Array.isArray(providers)) return []
  const result: DiscoveredProvider[] = []
  for (const entry of providers) {
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id : undefined
    if (!id) continue
    const modelsRaw = record.models
    const modelEntries = Array.isArray(modelsRaw)
      ? modelsRaw
      : typeof modelsRaw === "object" && modelsRaw !== null
        ? Object.values(modelsRaw)
        : []
    const models: DiscoveredModel[] = []
    for (const model of modelEntries) {
      if (typeof model !== "object" || model === null) continue
      const m = model as Record<string, unknown>
      const modelId = typeof m.id === "string" ? m.id : undefined
      if (!modelId) continue
      const cost = m.cost as { input?: number; output?: number } | undefined
      const limit = m.limit as { context?: number } | undefined
      // The OpenCode SDK nests these under `capabilities` (reasoning/toolcall);
      // accept the flat form too for hand-built or older payloads.
      const capabilities = m.capabilities as { reasoning?: unknown; toolcall?: unknown } | undefined
      const reasoning = capabilities?.reasoning ?? m.reasoning
      const toolCall = capabilities?.toolcall ?? m.tool_call
      models.push({
        id: modelId,
        name: typeof m.name === "string" ? m.name : undefined,
        ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
        ...(limit ? { limit: { context: limit.context } } : {}),
        reasoning: typeof reasoning === "boolean" ? reasoning : undefined,
        toolCall: typeof toolCall === "boolean" ? toolCall : undefined,
      })
    }
    result.push({ id, name: typeof record.name === "string" ? record.name : undefined, models })
  }
  return result
}

/**
 * Choose a paper price between what the provider reports and what models.dev
 * publishes.
 *
 * A provider reporting 0 does not mean the model is free: OpenCode zeroes the
 * price for subscription- and OAuth-backed providers because those calls are
 * not metered. Taking that 0 literally made frontier models look free, so every
 * role — including the cost-led one — recommended the most expensive models.
 *
 * Paper price is the baseline that effective cost is computed *from*; whether a
 * model is actually free to the user is decided by its billing source, not by a
 * missing meter. So prefer any real published price, and fall back to 0 only
 * when nobody publishes one (genuinely free models are 0 in models.dev too).
 */
function publishedPrice(fromProvider?: number, fromCatalog?: number): number | undefined {
  if (fromProvider !== undefined && fromProvider > 0) return fromProvider
  if (fromCatalog !== undefined && fromCatalog > 0) return fromCatalog
  // A zero is only believable when the catalog corroborates it. Otherwise the
  // provider simply is not metering (subscription, OAuth, or a gateway absent
  // from models.dev) and the price is unknown, not free. Reporting unknown
  // keeps these models from sweeping the cost-led ranking on a fake $0.
  if (fromProvider === 0 && fromCatalog === 0) return 0
  if (fromProvider === undefined) return fromCatalog
  return undefined
}

/**
 * Build the model catalog from the user's available providers, enriched with
 * models.dev pricing/capabilities and an optional quality index.
 */
export function buildCatalog(input: {
  providers: DiscoveredProvider[]
  modelsDev?: ModelsDevIndex
  quality?: QualityIndex
}): ModelCandidate[] {
  const candidates: ModelCandidate[] = []
  for (const provider of input.providers) {
    for (const model of provider.models) {
      const enrichment = input.modelsDev?.[provider.id]?.[model.id]
      const inputPerMillion = publishedPrice(model.cost?.input, enrichment?.cost?.input)
      const outputPerMillion = publishedPrice(model.cost?.output, enrichment?.cost?.output)
      const displayName = model.name ?? enrichment?.name ?? model.id
      const id = `${provider.id}/${model.id}`
      candidates.push({
        model: id,
        provider: provider.id,
        displayName,
        context: model.limit?.context ?? enrichment?.limit?.context,
        reasoning: model.reasoning ?? enrichment?.reasoning,
        toolCall: model.toolCall ?? enrichment?.tool_call,
        inputPerMillion,
        outputPerMillion,
        blendedPerMillion: blendedPaperCost(inputPerMillion, outputPerMillion),
        quality: input.quality?.match(id, displayName),
      })
    }
  }
  return candidates
}

/** Which economic weighting a role should be ranked by. */
export function roleWeighting(role: OrchestrationRole): "quality-led" | "balanced" | "cost-led" {
  switch (role) {
    case "orchestrator":
    case "deep":
    case "extreme-medium":
    case "extreme-high":
      return "quality-led"
    case "bulk":
      return "cost-led"
    default:
      return "balanced"
  }
}

export interface RankedCandidate extends ModelCandidate {
  billingSource: BillingSource
  effectivePerMillion?: number
  effectiveNote: string
  score: number
}

/**
 * Rank candidates for a role using effective cost (via the billing resolver)
 * and quality. `billingFor` lets the caller apply the user's per-provider
 * effective-cost knowledge; default it to "metered" before the interview.
 */
export function rankForRole(
  role: OrchestrationRole,
  candidates: ModelCandidate[],
  billingFor: (candidate: ModelCandidate) => BillingSource = () => "metered",
): RankedCandidate[] {
  const weighting = roleWeighting(role)
  return candidates
    // Every role delegates through tools, so a model that cannot call them is
    // unusable no matter how cheap. Without this, free embedding and TTS models
    // top the cost-led ranking. Unknown capability is kept, not assumed false.
    .filter((candidate) => candidate.toolCall !== false)
    .map((candidate) => {
      const billingSource = billingFor(candidate)
      const cost = effectiveCost(candidate.blendedPerMillion, billingSource)
      return {
        ...candidate,
        billingSource,
        effectivePerMillion: cost.perMillion,
        effectiveNote: cost.note,
        score: roleScore(weighting, { quality: candidate.quality?.score, effectivePerMillion: cost.perMillion }),
      }
    })
    .sort((a, b) => b.score - a.score)
}
