import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCatalog, indexModelsDev } from "../src/orchestration/catalog.js"
import { buildCatalog, normalizeProviders, rankForRole, roleWeighting } from "../src/orchestration/discovery.js"
import { blendedPaperCost, effectiveCost, roleScore } from "../src/orchestration/economics.js"
import { buildQualityIndex, parseArtificialAnalysisHtml, qualityKey, QUALITY_SNAPSHOT } from "../src/orchestration/quality.js"

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

const artificialAnalysisHtml = `<html><head>
<script type="application/ld+json">{"@type":"Dataset","name":"Cost per Intelligence Index Task","data":[{"label":"Ignore Me","intelligenceIndex":1}]}</script>
<script type="application/ld+json">{"@type":"Dataset","name":"Artificial Analysis Intelligence Index","isAccessibleForFree":true,"data":[
  {"label":"GPT-5.6 Sol (max)","intelligenceIndex":58.89},
  {"label":"DeepSeek V4 Pro (max)","intelligenceIndex":44.3}
]}</script>
</head><body></body></html>`

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
  test("normalizes ids and labels to the same key", () => {
    expect(qualityKey("GPT-5.6 Sol (max)")).toBe(qualityKey("gpt-5.6-sol"))
    expect(qualityKey("MiMo-V2.5-Pro")).toBe(qualityKey("mimo-v2.5-pro"))
    expect(qualityKey("Claude Fable 5 (with fallback)")).toBe(qualityKey("claude-fable-5"))
  })

  test("parses the intelligence index dataset from JSON-LD, ignoring other charts", () => {
    const entries = parseArtificialAnalysisHtml(artificialAnalysisHtml)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ label: "GPT-5.6 Sol (max)", intelligenceIndex: 58.89 })
    expect(entries.some((entry) => entry.label === "Ignore Me")).toBe(false)
  })

  test("returns nothing for unparsable markup so callers fall back", () => {
    expect(parseArtificialAnalysisHtml("<html><body>no data</body></html>")).toEqual([])
    expect(parseArtificialAnalysisHtml('<script type="application/ld+json">{oops</script>')).toEqual([])
  })

  test("matches provider/model ids against Artificial Analysis labels", () => {
    const index = buildQualityIndex(parseArtificialAnalysisHtml(artificialAnalysisHtml), true)
    const match = index.match("openai/gpt-5.6-sol", "GPT-5.6 Sol")
    expect(match?.intelligenceIndex).toBe(58.89)
    expect(match?.source).toBe("artificial-analysis-live")
    expect(index.match("openai/nonexistent-zzz")).toBeUndefined()
  })

  test("bundled snapshot is usable as a fallback index", () => {
    const index = buildQualityIndex(QUALITY_SNAPSHOT, false)
    expect(index.match("openai/gpt-5.6-sol")?.source).toBe("artificial-analysis-snapshot")
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
      quality: buildQualityIndex(parseArtificialAnalysisHtml(artificialAnalysisHtml), true),
    })
    const sol = catalog.find((entry) => entry.model === "openai/gpt-5.6-sol")
    expect(sol?.blendedPerMillion).toBe((3 * 5 + 30) / 4)
    expect(sol?.quality?.intelligenceIndex).toBe(58.89)
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
      quality: buildQualityIndex(parseArtificialAnalysisHtml(artificialAnalysisHtml), true),
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
            : artificialAnalysisHtml,
      })
      expect(result.qualitySource).toBe("Artificial Analysis (live)")
      expect(result.catalog).toHaveLength(2)
      expect(result.notes).toEqual([])
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
      expect(result.qualitySource).toBe("Artificial Analysis (bundled snapshot)")
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
        return url.includes("models.dev") ? "{}" : artificialAnalysisHtml
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
