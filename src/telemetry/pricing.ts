import type { ConfigTokenPrice, TokenRates, TokenUsage } from "./types.js"

export function normalizePricing(config?: Record<string, ConfigTokenPrice>): Record<string, TokenRates> {
  if (!config) return {}
  const result: Record<string, TokenRates> = {}
  for (const [key, price] of Object.entries(config)) {
    result[key] = {
      input: price.input ?? 0,
      output: price.output ?? 0,
      cacheRead: price.cacheRead ?? 0,
      cacheWrite: price.cacheWrite ?? 0,
    }
  }
  return result
}

export function computeApiEquivalentCost(tokens: TokenUsage, rates: TokenRates): number {
  return (
    (tokens.input / 1_000_000) * rates.input +
    ((tokens.output + tokens.reasoning) / 1_000_000) * rates.output +
    (tokens.cacheRead / 1_000_000) * rates.cacheRead +
    (tokens.cacheWrite / 1_000_000) * rates.cacheWrite
  )
}

export function lookupRate(modelKey: string, pricing: Record<string, TokenRates>): TokenRates | undefined {
  const exact = pricing[modelKey]
  if (exact) return exact
  const slash = modelKey.indexOf("/")
  if (slash === -1) return undefined
  const provider = modelKey.slice(0, slash)
  const wild = provider + "/*"
  if (pricing[wild]) return pricing[wild]
  return undefined
}
