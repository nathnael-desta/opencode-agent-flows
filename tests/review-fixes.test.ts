/**
 * Regression tests for defects found in review of the orchestration system.
 * Each test names the failure it prevents.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin.js"
import { discoverCatalog } from "../src/orchestration/catalog.js"
import { normalizeOrchestrationConfig } from "../src/orchestration/config.js"
import { buildCatalog, normalizeProviders, rankForRole } from "../src/orchestration/discovery.js"
import { buildQualityIndex, parseOpenRouterModels, QUALITY_SNAPSHOT } from "../src/orchestration/quality.js"

describe("S1: namespaced model ids", () => {
  // Over half of models.dev ids contain a slash inside the model half
  // (openrouter/anthropic/claude-sonnet-4). Requiring exactly one slash meant
  // discovery recommended models that flow_configure then refused to save.
  test("accepts aggregator ids with extra slashes", () => {
    for (const model of ["openrouter/anthropic/claude-sonnet-4", "nvidia/microsoft/phi-4-mini-instruct"]) {
      const config = normalizeOrchestrationConfig({ version: 1, roles: { orchestrator: { model }, routine: { model } } })
      expect(config.roles.orchestrator.model).toBe(model)
    }
  })

  test("still rejects values that are not provider/model", () => {
    for (const model of ["no-slash", "/leading", "with space/model"]) {
      expect(() => normalizeOrchestrationConfig({ version: 1, roles: { orchestrator: { model }, routine: { model } } })).toThrow()
    }
  })
})

describe("S2: quality matching must not inherit a flagship's score", () => {
  const index = buildQualityIndex(QUALITY_SNAPSHOT, false)

  test("derivative models do not inherit the flagship score", () => {
    // Each previously matched its flagship by substring and inherited a top
    // score, which would make a cheap small model outrank the real flagship.
    for (const derivative of [
      "anthropic/claude-fable-5-haiku",
      "openai/gpt-5.6-sol-mini",
      "google/gemini-3.6-flash-lite",
      "z-ai/glm-5.2-air",
    ]) {
      expect({ derivative, match: index.match(derivative) }).toEqual({ derivative, match: undefined })
    }
  })

  test("exact matches still resolve, preferring the coding index", () => {
    const sol = index.match("openai/gpt-5.6-sol")
    expect(sol?.matchedId).toBe("openai/gpt-5.6-sol")
    expect(sol?.scale).toBe("aa-coding-index")
    expect(index.match("google/gemini-3.6-flash")?.matchedId).toBe("google/gemini-3.6-flash")
  })

  test("matching does not depend on entry order", () => {
    const entries = [
      { id: "vendor/model-x-pro", coding: 90 },
      { id: "vendor/model-x", coding: 10 },
    ]
    const forward = buildQualityIndex(entries, true)
    const reversed = buildQualityIndex([...entries].reverse(), true)
    expect(forward.match("vendor/model-x")?.score).toBe(10)
    expect(reversed.match("vendor/model-x")?.score).toBe(10)
    expect(forward.match("vendor/model-x-pro")?.score).toBe(90)
  })

  test("canonicalization joins the dot and dash id spellings without collisions", () => {
    const index = buildQualityIndex([{ id: "anthropic/claude-opus-4.8", coding: 74.3 }], true)
    // models.dev spells the same model with dashes.
    expect(index.match("anthropic/claude-opus-4-8")?.score).toBe(74.3)
    expect(index.match("anthropic/claude-opus-4-7")).toBeUndefined()
  })

  test("resolves ids routed through the openrouter provider", () => {
    expect(index.match("openrouter/openai/gpt-5.6-sol")?.matchedId).toBe("openai/gpt-5.6-sol")
  })
})

describe("S3: ranking excludes models that cannot call tools", () => {
  test("a free embedding model never outranks a usable one", () => {
    const catalog = buildCatalog({
      providers: [
        { id: "nvidia", models: [{ id: "nv-embedcode", cost: { input: 0, output: 0 }, toolCall: false }] },
        { id: "commandcode", models: [{ id: "deepseek-v4-pro", cost: { input: 0.5, output: 1.5 }, toolCall: true }] },
      ],
    })
    const ranked = rankForRole("bulk", catalog)
    expect(ranked.map((entry) => entry.model)).toEqual(["commandcode/deepseek-v4-pro"])
  })

  test("unknown capability is kept rather than assumed false", () => {
    const catalog = buildCatalog({ providers: [{ id: "p", models: [{ id: "m", cost: { input: 1, output: 1 } }] }] })
    expect(rankForRole("bulk", catalog)).toHaveLength(1)
  })
})

describe("S4: a broken custom config must not disable the plugin", () => {
  test("missing config degrades to the built-in flow with tools intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flow-broken-"))
    try {
      const hooks: any = await plugin({}, { flow: "custom", telemetry: { reportDir: directory } })
      // The recovery tools still exist.
      expect(typeof hooks.tool.flow_configure.execute).toBe("function")
      const view = await hooks.tool.flow_config.execute({})
      expect(view).toContain("could not be loaded")
      expect(view).not.toContain("Status: active")
      // And a working flow is registered.
      const config: Record<string, any> = {}
      await hooks.config(config)
      expect(config.agent.orchestrator).toBeDefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("corrupt config degrades the same way and can be reset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flow-broken-"))
    try {
      await writeFile(join(directory, "orchestration-config.json"), "{ not json", "utf8")
      const hooks: any = await plugin({}, { flow: "custom", telemetry: { reportDir: directory } })
      expect(await hooks.tool.flow_config.execute({})).toContain("could not be loaded")
      // reset must delete a corrupt file, which is exactly when it is needed.
      expect(await hooks.tool.flow_configure.execute({ reset: true })).toContain("Removed")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("S5: budgets are clamped, not trusted", () => {
  test("absurd budgets cannot remove limits or disable review", () => {
    const config = normalizeOrchestrationConfig({
      version: 1,
      roles: { orchestrator: { model: "a/b" }, routine: { model: "a/b" } },
      orchestration: { maxTasksPerRun: 1e9, maxConcurrentWorkers: 1e9 },
      reviewer: { maxRounds: 0, maxFindings: -5, sampleRate: 99, maxPacketChars: -1 },
    })
    expect(config.orchestration?.maxTasksPerRun).toBeLessThanOrEqual(50)
    expect(config.orchestration?.maxConcurrentWorkers).toBeLessThanOrEqual(8)
    expect(config.reviewer?.maxRounds).toBeGreaterThanOrEqual(1)
    expect(config.reviewer?.maxFindings).toBeGreaterThanOrEqual(1)
    expect(config.reviewer?.sampleRate).toBeLessThanOrEqual(1)
    expect(config.reviewer?.maxPacketChars).toBeGreaterThanOrEqual(1_000)
  })

  test("fractional budgets become integers", () => {
    const config = normalizeOrchestrationConfig({
      version: 1,
      roles: { orchestrator: { model: "a/b" }, routine: { model: "a/b" } },
      orchestration: { maxConcurrentWorkers: 2.5 },
    })
    expect(Number.isInteger(config.orchestration?.maxConcurrentWorkers)).toBe(true)
  })
})

describe("S6: a cache write failure must not discard fetched data", () => {
  test("pricing survives an unwritable cache directory", async () => {
    const result = await discoverCatalog({
      providers: normalizeProviders({ providers: [{ id: "openai", models: { "gpt-5.6-sol": { id: "gpt-5.6-sol" } } }] }),
      // Unwritable: mkdir under /proc fails.
      cacheDir: "/proc/definitely-not-writable/cache",
      fetchText: async (url) =>
        url.includes("models.dev")
          ? JSON.stringify({ openai: { models: { "gpt-5.6-sol": { cost: { input: 5, output: 30 } } } } })
          : JSON.stringify({ data: [{ id: "openai/gpt-5.6-sol", benchmarks: { artificial_analysis: { coding_index: 77.4 } } }] }),
    })
    // The successful fetch is kept even though caching failed.
    expect(result.catalog[0].blendedPerMillion).toBe((3 * 5 + 30) / 4)
    expect(result.qualitySource).toContain("live")
    expect(result.notes.filter((note) => note.includes("unavailable"))).toEqual([])
  })
})

describe("S7: provider capabilities come from the SDK shape", () => {
  test("reads capabilities.toolcall and capabilities.reasoning", () => {
    const providers = normalizeProviders({
      providers: [{ id: "p", models: { m: { id: "m", capabilities: { reasoning: true, toolcall: false } } } }],
    })
    expect(providers[0].models[0].toolCall).toBe(false)
    expect(providers[0].models[0].reasoning).toBe(true)
  })

  test("still accepts the flat form", () => {
    const providers = normalizeProviders({ providers: [{ id: "p", models: { m: { id: "m", reasoning: true, tool_call: true } } }] })
    expect(providers[0].models[0].toolCall).toBe(true)
  })
})

describe("quality payload edge cases", () => {
  test("skips models with no benchmarks rather than failing", () => {
    const entries = parseOpenRouterModels({
      data: [{ id: "a/b" }, { id: "c/d", benchmarks: {} }, { id: "e/f", benchmarks: { artificial_analysis: { coding_index: 50 } } }],
    })
    expect(entries).toEqual([{ id: "e/f", coding: 50 }])
  })

  test("tolerates a payload missing the benchmarks field entirely", () => {
    // benchmarks.artificial_analysis is public but undocumented, so its
    // disappearance must degrade to the snapshot, not throw.
    expect(parseOpenRouterModels({ data: [{ id: "a/b", name: "B" }] })).toEqual([])
  })
})

describe("S9: rendering and no-op guards", () => {
  test("a pipe in a note cannot break the config table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flow-cell-"))
    try {
      const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
      await hooks.tool.flow_configure.execute({
        roles: JSON.stringify({
          orchestrator: { model: "a/b", effectiveCostNote: "has | pipe\nand newline" },
          routine: { model: "a/b" },
        }),
      })
      const view: string = await hooks.tool.flow_config.execute({})
      const row = view.split("\n").find((line) => line.startsWith("| orchestrator |")) ?? ""
      // Escaped pipe keeps the row at the expected column count.
      expect(row.split(/(?<!\\)\|/).length).toBe(7)
      expect(row).not.toContain("\n")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
