import { describe, expect, test } from "bun:test"
import type { ConfigTokenPrice, TokenUsage } from "../src/telemetry/types.js"
import { computeApiEquivalentCost, lookupRate, normalizePricing } from "../src/telemetry/pricing.js"

const usage: TokenUsage = { input: 1_000_000, output: 500_000, reasoning: 100_000, cacheRead: 200_000, cacheWrite: 50_000 }

describe("normalizePricing", () => {
  test("returns empty object for undefined or empty config", () => {
    expect(normalizePricing(undefined)).toEqual({})
    expect(normalizePricing({})).toEqual({})
  })

  test("converts ConfigTokenPrice to TokenRates with defaults for missing fields", () => {
    const config = {
      "openai/gpt-5": { input: 3.0, output: 15.0 },
      "commandcode/deepseek": { cacheRead: 0.5 },
    }
    const result = normalizePricing(config)
    expect(result["openai/gpt-5"]).toEqual({ input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 })
    expect(result["commandcode/deepseek"]).toEqual({ input: 0, output: 0, cacheRead: 0.5, cacheWrite: 0 })
  })

  test("all fields provided are passed through", () => {
    const config = {
      "openai/gpt-5": { input: 3.0, output: 15.0, cacheRead: 1.5, cacheWrite: 7.5 } satisfies ConfigTokenPrice,
    }
    const result = normalizePricing(config)
    expect(result["openai/gpt-5"]).toEqual({ input: 3.0, output: 15.0, cacheRead: 1.5, cacheWrite: 7.5 })
  })
})

describe("computeApiEquivalentCost", () => {
  test("computes cost from per-1M rates", () => {
    const rates = { input: 3.0, output: 15.0, cacheRead: 1.5, cacheWrite: 7.5 }
    const cost = computeApiEquivalentCost(usage, rates)
    expect(cost).toBe(12.675)
  })

  test("returns zero when all rates are zero", () => {
    const rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    expect(computeApiEquivalentCost(usage, rates)).toBe(0)
  })

  test("only applies non-zero rate categories", () => {
    const rates = { input: 2.0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const cost = computeApiEquivalentCost(usage, rates)
    expect(cost).toBeCloseTo(2.0, 6)
  })

  test("reasoning tokens are charged at output rate", () => {
    const rates = { input: 0, output: 10.0, cacheRead: 0, cacheWrite: 0 }
    const t: TokenUsage = { input: 0, output: 500_000, reasoning: 500_000, cacheRead: 0, cacheWrite: 0 }
    expect(computeApiEquivalentCost(t, rates)).toBe(10.0)
  })
})

describe("lookupRate", () => {
  const pricing = {
    "openai/gpt-5": { input: 3.0, output: 15.0, cacheRead: 1.5, cacheWrite: 7.5 },
    "openai/*": { input: 2.0, output: 10.0, cacheRead: 0, cacheWrite: 0 },
  }

  test("exact match returns the rate", () => {
    expect(lookupRate("openai/gpt-5", pricing)).toEqual(pricing["openai/gpt-5"])
  })

  test("wildcard match via provider/* returns fallback", () => {
    expect(lookupRate("openai/gpt-4o", pricing)).toEqual(pricing["openai/*"])
  })

  test("exact match beats wildcard", () => {
    expect(lookupRate("openai/gpt-5", pricing)).toBe(pricing["openai/gpt-5"])
  })

  test("no match returns undefined", () => {
    expect(lookupRate("anthropic/claude", pricing)).toBeUndefined()
  })

  test("key without slash returns undefined if no exact match", () => {
    expect(lookupRate("unknown", pricing)).toBeUndefined()
  })
})
