import { describe, expect, test } from "bun:test"
import { flows } from "../src/flows/index.js"
import { buildFlowFromConfig, composeOrchestratorPrompt, ROLE_TEMPLATES } from "../src/orchestration/roles.js"
import type { OrchestrationConfig } from "../src/orchestration/config.js"

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase()
}

describe("browser artifact routing", () => {
  test("built-in and custom prompts contain the Browser Control and visual-offload invariants", () => {
    const flow = flows["openai-commandcode-router"]
    const prompts = [
      normalise(flow.agents.orchestrator.prompt ?? ""),
      normalise(composeOrchestratorPrompt({ antigravity: true, browser: true })),
    ]

    for (const prompt of prompts) {
      expect(prompt).toContain(normalise("use them for all browser interaction"))
      expect(prompt).toContain(normalise("Load the Browser Control skill as operating policy and use MCP as the execution transport"))
      expect(prompt).toContain(normalise("one named or adopted session"))
      expect(prompt).toContain(normalise("one bounded snapshot of the relevant region"))
      expect(prompt).toContain(normalise("Use snapshot diff only for compatible same-page changes, never across navigation or reload"))
      expect(prompt).toContain(normalise("visual checkpoints only for the initial bug"))
      expect(prompt).toContain(normalise("maximum of three evidence-backed findings"))
      expect(prompt).toContain(normalise("never let it click, type, authenticate, approve, or control Browser Control"))
      expect(prompt).toContain(normalise("verify actionable findings through DOM, ARIA, computed styles, or bounding boxes"))
      expect(prompt).toContain(normalise("Browser Control handoff for CAPTCHA, 2FA, passkeys, payment confirmation"))
      expect(prompt).toContain(normalise("ask the user to attach or reconnect instead of silently switching to an isolated browser"))
      expect(prompt).toContain(normalise("If Antigravity is unavailable, continue semantic and DOM verification"))
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
      expect(prompt).toContain(normalise("long-horizon autonomy"))
      expect(prompt).toContain(normalise("agentic loop, escalation, and milestone review on your primary models"))
    }
  })

  test("Gemini 3.1 Pro downgrade is forbidden in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(composeOrchestratorPrompt({ antigravity: true, browser: true }))

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("do not substitute Gemini 3.1 Pro"))
    }
  })

  test("non-Google model routing through Antigravity is forbidden in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(composeOrchestratorPrompt({ antigravity: true, browser: true }))

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("do not route Claude or other non-Google models through it"))
    }
  })
})
