import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCatalog, indexModelsDev } from "../src/orchestration/catalog.js"
import { buildCatalog, normalizeProviders, rankForRole, roleWeighting } from "../src/orchestration/discovery.js"
import { blendedPaperCost, effectiveCost, roleScore } from "../src/orchestration/economics.js"
import { buildQualityIndex, parseOpenRouterModels, qualityKey, QUALITY_SNAPSHOT } from "../src/orchestration/quality.js"

const providersResponse = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", cost: { input: 5, output: 30 }, limit: { context: 400_000 }, reasoning: true, tool_call: true },
      },
    },
    {
      id: "commandcode",
      name: "Command Code",
      models: {
        "deepseek-v4-pro": { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", cost: { input: 0.5, output: 1.5 }, limit: { context: 128_000 } },
      },
    },
  ],
}

const openRouterPayload = JSON.stringify({
  data: [
    { id: "openai/gpt-5.6-sol", benchmarks: { artificial_analysis: { intelligence_index: 58.9, coding_index: 77.4, agentic_index: 54 } } },
    { id: "deepseek/deepseek-v4-pro", benchmarks: { artificial_analysis: { intelligence_index: 44.3, coding_index: 59.4, agentic_index: 36.4 } } },
    { id: "vendor/no-benchmarks", name: "No benchmarks" },
  ],
})

const quality = () => buildQualityIndex(parseOpenRouterModels(JSON.parse(openRouterPayload)), true)

describe("economics", () => {
  test("blends input and output 3:1", () => {
    expect(blendedPaperCost(4, 8)).toBe(5)
    expect(blendedPaperCost(undefined, undefined)).toBeUndefined()
  })

  test("subscription and bundled billing drive marginal cost to zero", () => {
    expect(effectiveCost(20, "subscription-flat").perMillion).toBe(0)
    expect(effectiveCost(20, "bundled-credit").perMillion).toBe(0)
    expect(effectiveCost(20, "metered").perMillion).toBe(20)
    expect(effectiveCost(20, "credit-pool").perMillion).toBe(20)
  })

  test("cost-led scoring prefers cheap, quality-led prefers strong", () => {
    const cheapWeak = { quality: 30, effectivePerMillion: 0.2 }
    const dearStrong = { quality: 58, effectivePerMillion: 20 }
    expect(roleScore("cost-led", cheapWeak)).toBeGreaterThan(roleScore("cost-led", dearStrong))
    expect(roleScore("quality-led", dearStrong)).toBeGreaterThan(roleScore("quality-led", cheapWeak))
  })
})

describe("quality", () => {
  test("canonicalizes ids across the dot/dash difference between sources", () => {
    // OpenRouter writes claude-opus-4.8; models.dev writes claude-opus-4-8.
    expect(qualityKey("anthropic/claude-opus-4.8")).toBe(qualityKey("anthropic/claude-opus-4-8"))
    expect(qualityKey("OpenAI/GPT-5.6-Sol")).toBe(qualityKey("openai/gpt-5-6-sol"))
  })

  test("parses the artificial_analysis benchmarks block", () => {
    const entries = parseOpenRouterModels(JSON.parse(openRouterPayload))
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ id: "openai/gpt-5.6-sol", intelligence: 58.9, coding: 77.4, agentic: 54 })
    expect(entries.some((entry) => entry.id === "vendor/no-benchmarks")).toBe(false)
  })

  test("returns nothing for unusable payloads so callers fall back", () => {
    expect(parseOpenRouterModels(null)).toEqual([])
    expect(parseOpenRouterModels({ data: "nope" })).toEqual([])
    expect(parseOpenRouterModels({ data: [{ id: "a/b" }] })).toEqual([])
  })

  test("prefers the coding index and records the scale", () => {
    const match = quality().match("openai/gpt-5.6-sol")
    expect(match?.score).toBe(77.4)
    expect(match?.scale).toBe("aa-coding-index")
    expect(match?.intelligence).toBe(58.9)
    expect(match?.source).toBe("openrouter-live")
  })

  test("resolves models routed through the openrouter provider", () => {
    expect(quality().match("openrouter/openai/gpt-5.6-sol")?.score).toBe(77.4)
  })

  test("does not match unrelated or derivative ids", () => {
    expect(quality().match("openai/nonexistent-zzz")).toBeUndefined()
    expect(quality().match("openai/gpt-5.6-sol-mini")).toBeUndefined()
  })

  test("bundled snapshot is usable as a fallback index", () => {
    const index = buildQualityIndex(QUALITY_SNAPSHOT, false)
    expect(index.size).toBeGreaterThan(50)
    expect(index.match("openai/gpt-5.6-sol")?.source).toBe("openrouter-snapshot")
  })
})

describe("catalog assembly", () => {
  test("normalizes the client providers response", () => {
    const providers = normalizeProviders(providersResponse)
    expect(providers).toHaveLength(2)
    expect(providers[0].models[0].id).toBe("gpt-5.6-sol")
    expect(normalizeProviders(undefined)).toEqual([])
    expect(normalizeProviders({ providers: "nope" })).toEqual([])
  })

  test("indexes models.dev into provider -> model fields", () => {
    const index = indexModelsDev({ openai: { models: { "gpt-5.6-sol": { name: "GPT-5.6 Sol", cost: { input: 5, output: 30 } } } } })
    expect(index.openai["gpt-5.6-sol"].cost?.input).toBe(5)
    expect(indexModelsDev(null)).toEqual({})
  })

  test("builds candidates with pricing and quality", () => {
    const catalog = buildCatalog({
      providers: normalizeProviders(providersResponse),
      quality: quality(),
    })
    const sol = catalog.find((entry) => entry.model === "openai/gpt-5.6-sol")
    expect(sol?.blendedPerMillion).toBe((3 * 5 + 30) / 4)
    expect(sol?.quality?.score).toBe(77.4)
    expect(sol?.context).toBe(400_000)
  })

  test("falls back to models.dev pricing when the provider omits cost", () => {
    const catalog = buildCatalog({
      providers: [{ id: "openai", models: [{ id: "gpt-5.6-sol" }] }],
      modelsDev: { openai: { "gpt-5.6-sol": { cost: { input: 5, output: 30 }, name: "GPT-5.6 Sol" } } },
    })
    expect(catalog[0].blendedPerMillion).toBe((3 * 5 + 30) / 4)
    expect(catalog[0].displayName).toBe("GPT-5.6 Sol")
  })

  test("ranks roles by their weighting and honors billing sources", () => {
    const catalog = buildCatalog({
      providers: normalizeProviders(providersResponse),
      quality: quality(),
    })
    expect(roleWeighting("bulk")).toBe("cost-led")
    expect(roleWeighting("orchestrator")).toBe("quality-led")
    // Metered: bulk prefers the cheap model.
    expect(rankForRole("bulk", catalog)[0].model).toBe("commandcode/deepseek-v4-pro")
    // Treating the expensive model as subscription-flat makes it free at the
    // margin, so it wins even the cost-led role. This is the Gemini-Flash-via-
    // bundle case: paper-expensive, effectively cheap.
    const ranked = rankForRole("bulk", catalog, (candidate) => (candidate.provider === "openai" ? "subscription-flat" : "metered"))
    expect(ranked[0].model).toBe("openai/gpt-5.6-sol")
    expect(ranked[0].effectivePerMillion).toBe(0)
  })
})

describe("discoverCatalog degradation", () => {
  test("uses live sources when reachable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cat-"))
    try {
      const result = await discoverCatalog({
        providers: normalizeProviders(providersResponse),
        cacheDir: dir,
        fetchText: async (url) =>
          url.includes("models.dev")
            ? JSON.stringify({ openai: { models: { "gpt-5.6-sol": { cost: { input: 5, output: 30 } } } } })
            : openRouterPayload,
      })
      expect(result.qualitySource).toContain("live")
      expect(result.catalog).toHaveLength(2)
      // The small fixture trips the coverage-drop warning; no source failed.
      expect(result.notes.filter((note) => note.includes("unavailable"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("falls back to the bundled snapshot and still returns a catalog offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cat-"))
    try {
      const result = await discoverCatalog({
        providers: normalizeProviders(providersResponse),
        cacheDir: dir,
        fetchText: async () => {
          throw new Error("offline")
        },
      })
      expect(result.qualitySource).toContain("bundled snapshot")
      expect(result.catalog).toHaveLength(2)
      expect(result.notes.join(" ")).toContain("offline")
      // Provider-supplied pricing still works with models.dev unavailable.
      expect(result.catalog.find((entry) => entry.model === "openai/gpt-5.6-sol")?.blendedPerMillion).toBe((3 * 5 + 30) / 4)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reuses the cache on a second call without refetching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cat-"))
    try {
      let fetches = 0
      const fetchText = async (url: string) => {
        fetches += 1
        return url.includes("models.dev") ? "{}" : openRouterPayload
      }
      const providers = normalizeProviders(providersResponse)
      await discoverCatalog({ providers, cacheDir: dir, fetchText })
      const firstCount = fetches
      await discoverCatalog({ providers, cacheDir: dir, fetchText })
      expect(fetches).toBe(firstCount)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
