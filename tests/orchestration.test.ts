import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadOrchestrationConfig,
  normalizeOrchestrationConfig,
  saveOrchestrationConfig,
  type OrchestrationConfig,
} from "../src/orchestration/config.js"
import { buildFlowFromConfig } from "../src/orchestration/roles.js"
import { renderDashboard } from "../src/telemetry/dashboard.js"

const minimal: OrchestrationConfig = {
  version: 1,
  roles: {
    orchestrator: { model: "openai/gpt-5.6-sol", variant: "low", billingSource: "subscription-flat" },
    routine: { model: "commandcode/deepseek-v4-pro", variant: "high", billingSource: "credit-pool" },
  },
}

describe("orchestration config", () => {
  test("requires orchestrator and routine roles", () => {
    expect(() => normalizeOrchestrationConfig({ version: 1, roles: {} })).toThrow(/orchestrator/)
    expect(() => normalizeOrchestrationConfig({ version: 1, roles: { orchestrator: { model: "openai/gpt-5.6-sol" } } })).toThrow(/routine/)
  })

  test("rejects malformed model bindings", () => {
    expect(() => normalizeOrchestrationConfig({ version: 1, roles: { orchestrator: { model: "not-a-model" }, routine: { model: "a/b" } } })).toThrow(/provider\/model/)
  })

  test("normalizes unknown billing sources rather than failing", () => {
    const config = normalizeOrchestrationConfig({
      version: 1,
      roles: {
        orchestrator: { model: "openai/gpt-5.6-sol", billingSource: "mystery-plan" },
        routine: { model: "a/b" },
      },
    })
    expect(config.roles.orchestrator.billingSource).toBe("unknown")
  })

  test("round-trips through save and load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-"))
    try {
      const path = join(dir, "orchestration-config.json")
      await saveOrchestrationConfig(path, minimal)
      const loaded = await loadOrchestrationConfig(path)
      expect(loaded.roles.orchestrator.model).toBe("openai/gpt-5.6-sol")
      expect(loaded.roles.routine.billingSource).toBe("credit-pool")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("load throws a setup-oriented error when the file is absent", async () => {
    await expect(loadOrchestrationConfig(join(tmpdir(), "does-not-exist-orch.json"))).rejects.toThrow(/setup skill|flow_configure/)
  })

  test("load reports invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-"))
    try {
      const path = join(dir, "bad.json")
      await writeFile(path, "{ not json", "utf8")
      await expect(loadOrchestrationConfig(path)).rejects.toThrow(/not valid JSON/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("buildFlowFromConfig", () => {
  test("binds all roles, falling back for omitted ones", () => {
    const flow = buildFlowFromConfig(minimal)
    expect(flow.id).toBe("custom")
    expect(flow.defaultAgent).toBe("orchestrator")
    // orchestrator + routine explicit
    expect(flow.agents.orchestrator.model).toBe("openai/gpt-5.6-sol")
    expect(flow.agents.routine.model).toBe("commandcode/deepseek-v4-pro")
    // bulk and reviewer fall back to routine
    expect(flow.agents.bulk.model).toBe("commandcode/deepseek-v4-pro")
    expect(flow.agents.reviewer.model).toBe("commandcode/deepseek-v4-pro")
    // deep and extreme-* fall back to orchestrator
    expect(flow.agents.deep.model).toBe("openai/gpt-5.6-sol")
    expect(flow.agents["extreme-high"].model).toBe("openai/gpt-5.6-sol")
  })

  test("prefers explicit bindings over fallbacks", () => {
    const flow = buildFlowFromConfig({
      ...minimal,
      roles: {
        ...minimal.roles,
        bulk: { model: "commandcode/mimo-v2.5" },
        reviewer: { model: "commandcode/mimo-v2.5-pro" },
      },
    })
    expect(flow.agents.bulk.model).toBe("commandcode/mimo-v2.5")
    expect(flow.agents.reviewer.model).toBe("commandcode/mimo-v2.5-pro")
  })

  test("keeps guardrails plugin-owned regardless of config", () => {
    const flow = buildFlowFromConfig(minimal)
    // Reviewer cannot edit or run shell; escalation requires approval.
    expect(flow.agents.reviewer.permission).toMatchObject({ edit: "deny", bash: "deny" })
    expect(flow.agentMetadata.deep.requiresApproval).toBe(true)
    expect(flow.agentMetadata["extreme-high"].requiresApproval).toBe(true)
    // Orchestrator prompt is the plugin's, not user text.
    expect(flow.agents.orchestrator.prompt).toContain("Classify each request")
  })

  test("carries billing source into metadata and honors budget overrides", () => {
    const flow = buildFlowFromConfig({
      ...minimal,
      orchestration: { maxTasksPerRun: 20, maxConcurrentWorkers: 5 },
      reviewer: { enabled: false, maxRounds: 1 },
    })
    expect(flow.agentMetadata.orchestrator.billingSource).toBe("subscription-flat")
    expect(flow.orchestration.maxTasksPerRun).toBe(20)
    expect(flow.orchestration.maxConcurrentWorkers).toBe(5)
    expect(flow.reviewer?.enabled).toBe(false)
    expect(flow.reviewer?.maxRounds).toBe(1)
  })

  test("generated orchestrator prompt matches built-in policy for direct fixes, consolidation, skills, and escalation", () => {
    const flow = buildFlowFromConfig(minimal)
    const prompt = flow.agents.orchestrator.prompt as string
    expect(prompt).toContain("Reserve direct edits for truly trivial corrections")
    expect(prompt).toContain("Consolidate multiple review requests")
    expect(prompt).toContain("Skills suggest")
    expect(prompt).toContain("first re-delegate the same Task ID")
    expect(prompt).toContain("advisory evidence")
    expect(prompt).toContain("max two total")
    expect(prompt).toContain("Verification must be proportionate")
  })
})

describe("dashboard orchestration panel", () => {
  const emptyGlobal = {
    generatedAt: Date.now(),
    runs: 0,
    totals: { costUsd: 0, apiEquivalentCostUsd: 0, subagentsSpawned: 0, apiEquivalentUnpricedCalls: 0 },
    latestQuotas: [],
  } as any

  test("renders a placeholder when nothing is configured", () => {
    const html = renderDashboard(emptyGlobal, [])
    expect(html).toContain("No orchestration configuration is saved")
    expect(html).toContain("flow-setup")
  })

  test("embeds the saved configuration for the panel", () => {
    const html = renderDashboard(emptyGlobal, [], {
      ...minimal,
      title: "My setup",
      roles: { ...minimal.roles, bulk: { model: "google/gemini-3.6-flash", billingSource: "bundled-credit", effectiveCostNote: "Antigravity" } },
    })
    expect(html).toContain("My setup")
    expect(html).toContain("google/gemini-3.6-flash")
    expect(html).toContain("bundled-credit")
    expect(html).toContain("Antigravity")
  })

  test("escapes angle brackets in embedded JSON so the script cannot be broken", () => {
    const html = renderDashboard(emptyGlobal, [], {
      ...minimal,
      title: "</script><script>alert(1)</script>",
    })
    expect(html).not.toContain("</script><script>alert(1)")
  })

  // The dashboard's rendering logic lives in an inline <script> that no
  // typechecker sees. A misplaced paren there once threw on the first render
  // line and blanked the entire dashboard, so execute it here.
  function runDashboardScript(html: string) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/)
    if (!match) throw new Error("dashboard has no inline script")
    const store: Record<string, any> = {}
    const element = (id: string) =>
      (store[id] ??= {
        _html: "",
        _text: "",
        set innerHTML(value: string) { this._html = value },
        get innerHTML() { return this._html },
        set textContent(value: string) { this._text = value },
        get textContent() { return this._text },
        style: {},
        onclick: null,
        dataset: {},
      })
    const document = { querySelector: (selector: string) => element(selector), querySelectorAll: () => [] }
    new Function("document", match[1])(document)
    return store
  }

  test("the inline dashboard script executes without runtime errors", () => {
    const store = runDashboardScript(renderDashboard(emptyGlobal, [], minimal))
    // Cards render, proving execution reached the first render line.
    expect(store["#cards"]._html).toContain("Runs")
    expect(store["#orchestration"]._html).toContain("orchestrator")
  })

  test("the panel shows inheritance and effective cost", () => {
    const store = runDashboardScript(
      renderDashboard(emptyGlobal, [], {
        ...minimal,
        roles: { ...minimal.roles, bulk: { model: "google/gemini-3.6-flash", billingSource: "bundled-credit" } },
      }),
    )
    const panel = store["#orchestration"]._html
    expect(panel).toContain("inherits routine")
    expect(panel).toContain("~$0/M")
    expect(panel).toContain("paper price")
  })
})
