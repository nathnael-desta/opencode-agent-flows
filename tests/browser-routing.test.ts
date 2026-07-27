import { describe, expect, test } from "bun:test"
import { flows } from "../src/flows/index.js"
import { buildFlowFromConfig, ROLE_TEMPLATES } from "../src/orchestration/roles.js"
import type { OrchestrationConfig } from "../src/orchestration/config.js"

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase()
}

describe("browser artifact routing", () => {
  test("built-in flow orchestrator prompt contains Playwright/browser routing policy", () => {
    const flow = flows["openai-commandcode-router"]
    const prompt = normalise(flow.agents.orchestrator.prompt ?? "")

    expect(prompt).toContain(normalise("antigravity_delegate, antigravity_vision, or antigravity_background"))
    expect(prompt).toContain(normalise("antigravity_vision; large-context whole-repo or whole-log reads"))
    expect(prompt).toContain(normalise("Gemini Flash is weak at long-horizon autonomy"))

    expect(prompt).toContain(normalise("When you drive Playwright or equivalent browser tools"))
    expect(prompt).toContain(normalise("route screenshots and rendered PDFs to antigravity_vision"))
    expect(prompt).toContain(normalise("Route textual artifacts — accessibility snapshots, console excerpts, network summaries, and text trace excerpts — to antigravity_delegate"))
    expect(prompt).toContain(normalise("spot layout breaks, missing text, overflow, dark-mode mismatches"))
    expect(prompt).toContain(normalise("Do not delegate individual clicks or interactions to Gemini"))
    expect(prompt).toContain(normalise("do not run autonomous destructive flows"))
    expect(prompt).toContain(normalise("do not claim Gemini controls Playwright"))
    expect(prompt).toContain(normalise("can reduce expensive primary-model context and uses bundled quota"))
    expect(prompt).toContain(normalise("Binary Playwright traces cannot be passed directly to either tool"))
  })

  test("built-in flow routing rules include browser/artifact routing entries", () => {
    const flow = flows["openai-commandcode-router"]
    const rules = flow.routingRules.map((r) => normalise(r))

    expect(rules).toContain(normalise("Route images, screenshots, PDFs, diagrams, and large-context reads to antigravity_vision or antigravity_delegate via Gemini 3.6 Flash when Antigravity is available."))
    expect(rules.some((r) => r.includes(normalise("split visual outputs (screenshots, rendered PDFs) to antigravity_vision")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("textual artifacts (accessibility snapshots, console excerpts, network summaries, text trace excerpts) to antigravity_delegate")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("Extract bounded screenshots or text from binary Playwright traces before routing")))).toBe(true)
  })

  test("built-in flow limitations include browser routing disclaimer", () => {
    const flow = flows["openai-commandcode-router"]
    const limitation = normalise(flow.limitations.find((l) => l.includes("Browser")) ?? "")

    expect(limitation).toContain(normalise("Browser/frontend artifact routing through Antigravity is a prompt policy"))
    expect(limitation).toContain(normalise("does not provide a Playwright MCP integration or intercept browser tool calls"))
  })

  test("custom flow orchestrator prompt contains identical Playwright/browser routing policy", () => {
    const prompt = normalise(ROLE_TEMPLATES.orchestrator.prompt ?? "")

    expect(prompt).toContain(normalise("antigravity_delegate, antigravity_vision, or antigravity_background"))
    expect(prompt).toContain(normalise("antigravity_vision; large-context whole-repo or whole-log reads"))
    expect(prompt).toContain(normalise("Gemini Flash is weak at long-horizon autonomy"))

    expect(prompt).toContain(normalise("When you drive Playwright or equivalent browser tools"))
    expect(prompt).toContain(normalise("route screenshots and rendered PDFs to antigravity_vision"))
    expect(prompt).toContain(normalise("Route textual artifacts — accessibility snapshots, console excerpts, network summaries, and text trace excerpts — to antigravity_delegate"))
    expect(prompt).toContain(normalise("spot layout breaks, missing text, overflow, dark-mode mismatches"))
    expect(prompt).toContain(normalise("Do not delegate individual clicks or interactions to Gemini"))
    expect(prompt).toContain(normalise("do not run autonomous destructive flows"))
    expect(prompt).toContain(normalise("do not claim Gemini controls Playwright"))
    expect(prompt).toContain(normalise("can reduce expensive primary-model context and uses bundled quota"))
    expect(prompt).toContain(normalise("Binary Playwright traces cannot be passed directly to either tool"))
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

    expect(rules).toContain(normalise("Route images, screenshots, PDFs, diagrams, and large-context reads to antigravity_vision or antigravity_delegate via Gemini 3.6 Flash when Antigravity is available."))
    expect(rules.some((r) => r.includes(normalise("split visual outputs (screenshots, rendered PDFs) to antigravity_vision")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("textual artifacts (accessibility snapshots, console excerpts, network summaries, text trace excerpts) to antigravity_delegate")))).toBe(true)
    expect(rules.some((r) => r.includes(normalise("Extract bounded screenshots or text from binary Playwright traces before routing")))).toBe(true)
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

    expect(limitation).toContain(normalise("Browser/frontend artifact routing through Antigravity is a prompt policy"))
    expect(limitation).toContain(normalise("does not provide a Playwright MCP integration or intercept browser tool calls"))
  })

  test("Gemini Flash weakness is stated in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(ROLE_TEMPLATES.orchestrator.prompt ?? "")

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("long-horizon autonomy"))
      expect(prompt).toContain(normalise("agentic loop, escalation, and milestone review on your primary models"))
    }
  })

  test("Gemini 3.1 Pro downgrade is forbidden in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(ROLE_TEMPLATES.orchestrator.prompt ?? "")

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("do not substitute Gemini 3.1 Pro"))
    }
  })

  test("non-Google model routing through Antigravity is forbidden in both prompts", () => {
    const builtin = normalise(flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "")
    const custom = normalise(ROLE_TEMPLATES.orchestrator.prompt ?? "")

    for (const prompt of [builtin, custom]) {
      expect(prompt).toContain(normalise("do not route Claude or other non-Google models through it"))
    }
  })
})
