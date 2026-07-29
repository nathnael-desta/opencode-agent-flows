import { describe, expect, test } from "bun:test"
import { flows } from "../src/flows/index.js"
import { buildFlowFromConfig, composeOrchestratorPrompt, ROLE_TEMPLATES } from "../src/orchestration/roles.js"
import type { OrchestrationConfig } from "../src/orchestration/config.js"

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase()
}

describe("browser artifact routing", () => {
  // Detailed operating policy moved to the browser-control-operations and
  // antigravity-delegation skills, which load on demand instead of costing
  // context on every turn. The prompt keeps the pointer and the routing
  // invariants that must hold before any skill is loaded.
  test("built-in and custom prompts point at the operating-policy skills", () => {
    const flow = flows["openai-commandcode-router"]
    const prompts = [
      normalise(flow.agents.orchestrator.prompt ?? ""),
      normalise(composeOrchestratorPrompt({ antigravity: true, browser: true })),
    ]

    for (const prompt of prompts) {
      expect(prompt).toContain(normalise("load the browser-control-operations skill"))
      expect(prompt).toContain(normalise("load the antigravity-delegation skill"))
    }
  })

  test("built-in flow routing rules include browser/artifact routing entries", () => {
    const flow = flows["openai-commandcode-router"]
    const rules = flow.routingRules.map((r) => normalise(r))

    expect(rules.some((r) => r.includes(normalise("Use Browser Control MCP as the default browser transport")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("one bounded snapshot, focused structured assertions, same-page diffs only")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("keep browser control and finding disposition on the primary orchestrator")))).toBe(true)
  })

  test("built-in flow limitations include browser routing disclaimer", () => {
    const flow = flows["openai-commandcode-router"]
    const limitation = normalise(flow.limitations.find((l) => l.includes("Browser")) ?? "")

    expect(limitation).toContain(normalise("Browser Control and Antigravity routing is prompt policy"))
    expect(limitation).toContain(normalise("neither installs Browser Control nor Antigravity"))
    expect(normalise(flow.limitations.join(" "))).toContain(normalise("Antigravity visual findings are advisory and can lose interaction context"))
  })

  test("custom flow routing rules include the same browser/artifact entries", () => {
    const minimal = {
      version: 1,
      roles: {
        orchestrator: { model: "openai/gpt-5.6-sol", variant: "low", billingSource: "subscription-flat" },
        routine: { model: "commandcode/deepseek-v4-pro", variant: "high", billingSource: "credit-pool" },
      },
    } as OrchestrationConfig
    const flow = buildFlowFromConfig(minimal)
    const rules = flow.routingRules.map((r: string) => normalise(r))

    expect(rules.some((r) => r.includes(normalise("Use Browser Control MCP as the default browser transport")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("one bounded snapshot, focused structured assertions, same-page diffs only")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("keep browser control and finding disposition on the primary orchestrator")))).toBe(true)
  })

  test("custom flow limitations include the browser routing disclaimer", () => {
    const minimal = {
      version: 1,
      roles: {
        orchestrator: { model: "openai/gpt-5.6-sol", variant: "low", billingSource: "subscription-flat" },
        routine: { model: "commandcode/deepseek-v4-pro", variant: "high", billingSource: "credit-pool" },
      },
    } as OrchestrationConfig
    const flow = buildFlowFromConfig(minimal)
    const limitation = normalise(flow.limitations.find((l: string) => l.includes("Browser")) ?? "")

    expect(limitation).toContain(normalise("Browser Control and Antigravity routing is prompt policy"))
    expect(limitation).toContain(normalise("neither installs Browser Control nor Antigravity"))
    expect(normalise(flow.limitations.join(" "))).toContain(normalise("Antigravity visual findings are advisory and can lose interaction context"))
  })

  test("Gemini Flash weakness is stated in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(composeOrchestratorPrompt({ antigravity: true, browser: true }))

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("weak at long-horizon autonomy"))
      expect(prompt).toContain(normalise("escalation, or milestone review on your primary models"))
    }
  })

  test("non-Google model routing through Antigravity is forbidden in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(composeOrchestratorPrompt({ antigravity: true, browser: true }))

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("Route only Google Gemini models through Antigravity"))
    }
  })
})
