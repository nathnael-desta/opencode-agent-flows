import type { BillingSource } from "./config.js"

/**
 * Paper prices are USD per 1,000,000 tokens (the models.dev convention).
 * We blend input and output 3:1, matching how Artificial Analysis reports a
 * single "blended" price, so a lone number can rank models.
 */
export function blendedPaperCost(inputPerMillion?: number, outputPerMillion?: number): number | undefined {
  if (inputPerMillion === undefined && outputPerMillion === undefined) return undefined
  const input = inputPerMillion ?? 0
  const output = outputPerMillion ?? 0
  return (3 * input + output) / 4
}

export interface EffectiveCost {
  /** USD per 1M tokens the user effectively pays at the margin, if known. */
  perMillion?: number
  /** Short human explanation of how the effective cost was derived. */
  note: string
}

/**
 * Translate a paper price into what the user actually pays at the margin, given
 * how the model is billed. This is the core of the "expensive on paper, cheap
 * for me" idea: a subscription or a prepaid bundle makes marginal cost ~0.
 */
export function effectiveCost(blended: number | undefined, billingSource: BillingSource): EffectiveCost {
  switch (billingSource) {
    case "subscription-flat":
      return { perMillion: 0, note: "flat subscription — ~$0 marginal within plan capacity" }
    case "bundled-credit":
      return { perMillion: 0, note: "prepaid bundle — treat as ~free until the bundle is exhausted" }
    case "credit-pool":
      return blended === undefined
        ? { note: "drawn from a monthly credit pool at paper price (paper price unknown)" }
        : { perMillion: blended, note: "paper price, drawn from a monthly credit pool" }
    case "metered":
      return blended === undefined ? { note: "metered at paper price (paper price unknown)" } : { perMillion: blended, note: "metered at paper price" }
    default:
      return blended === undefined ? { note: "billing unknown; paper price unknown" } : { perMillion: blended, note: "billing unknown; assuming paper price" }
  }
}

/**
 * Combine effective cost and a quality index into one comparable score for a
 * role. Higher is better. Quality-led roles weight the index; cost-led roles
 * weight cheapness. The formula is intentionally simple and transparent so the
 * setup skill can explain a ranking to the user.
 */
export function roleScore(
  role: "quality-led" | "balanced" | "cost-led",
  input: { quality?: number; effectivePerMillion?: number },
): number {
  const quality = input.quality ?? 0
  // Cheapness in [0,1]: $0 → 1, $30/M → ~0. Unknown cost is treated as mid.
  const cost = input.effectivePerMillion
  const cheapness = cost === undefined ? 0.5 : 1 / (1 + cost / 5)
  switch (role) {
    case "quality-led":
      return quality * 1 + cheapness * 10
    case "cost-led":
      return cheapness * 100 + quality * 0.2
    default:
      return quality * 0.6 + cheapness * 40
  }
}
