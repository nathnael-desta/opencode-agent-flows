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
})
