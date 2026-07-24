/**
 * The setup CLI's decision logic, extracted so it is testable without driving
 * a terminal. The interactive and non-interactive paths both go through these.
 */
import { describe, expect, test } from "bun:test"
import {
  buildOrchestrationConfig,
  isModelReference,
  normalizeBillingAnswer,
  providerOf,
  providersNeedingBilling,
  resolveSelection,
} from "../src/orchestration/setup.js"

const ranked = [{ model: "openai/gpt-5.6-sol" }, { model: "commandcode/deepseek-v4-pro" }]

describe("role selection", () => {
  test("accepts a 1-based index", () => {
    expect(resolveSelection("1", ranked)).toEqual({ model: "openai/gpt-5.6-sol" })
    expect(resolveSelection("2", ranked)).toEqual({ model: "commandcode/deepseek-v4-pro" })
  })

  test("accepts an explicit provider/model, including namespaced ids", () => {
    expect(resolveSelection("openrouter/anthropic/claude-sonnet-4", ranked)).toEqual({ model: "openrouter/anthropic/claude-sonnet-4" })
  })

  test("blank inherits", () => {
    expect(resolveSelection("", ranked)).toEqual({ inherit: true })
    expect(resolveSelection("   ", ranked)).toEqual({ inherit: true })
  })

  test("reports an error rather than silently dropping the role", () => {
    // Silently skipping used to lose a required role and only fail at the end.
    expect(resolveSelection("99", ranked).error).toMatch(/between 1 and 2/)
    expect(resolveSelection("garbage", ranked).error).toMatch(/not a provider\/model/)
    expect(resolveSelection("99", ranked).model).toBeUndefined()
  })
})

describe("billing answers", () => {
  test("accepts an index, a name, or blank for metered", () => {
    expect(normalizeBillingAnswer("")).toBe("metered")
    expect(normalizeBillingAnswer("1")).toBe("metered")
    expect(normalizeBillingAnswer("subscription-flat")).toBe("subscription-flat")
    expect(normalizeBillingAnswer("bundled-credit")).toBe("bundled-credit")
  })

  test("rejects unknown values so the caller can re-ask", () => {
    expect(normalizeBillingAnswer("free-lunch")).toBeUndefined()
    expect(normalizeBillingAnswer("99")).toBeUndefined()
  })
})

describe("config assembly", () => {
  test("applies per-provider billing and notes to every role of that provider", () => {
    const config = buildOrchestrationConfig({
      selections: {
        orchestrator: "openai/gpt-5.6-sol",
        routine: "commandcode/deepseek-v4-pro",
        bulk: "google/gemini-3.6-flash",
      },
      billing: { openai: "subscription-flat", google: "bundled-credit" },
      notes: { openai: "ChatGPT Plus", google: "Antigravity credits" },
      title: "Mine",
    })
    expect(config.title).toBe("Mine")
    expect(config.roles.orchestrator).toMatchObject({ billingSource: "subscription-flat", effectiveCostNote: "ChatGPT Plus" })
    expect(config.roles.bulk).toMatchObject({ billingSource: "bundled-credit", effectiveCostNote: "Antigravity credits" })
    // Unspecified providers default to metered rather than guessing.
    expect(config.roles.routine.billingSource).toBe("metered")
  })

  test("rejects a selection set missing a required role", () => {
    expect(() => buildOrchestrationConfig({ selections: { bulk: "a/b" } })).toThrow(/orchestrator/)
  })

  test("asks about each provider once, in first-seen order", () => {
    expect(
      providersNeedingBilling({ orchestrator: "openai/a", routine: "commandcode/b", bulk: "openai/c", reviewer: "google/d" }),
    ).toEqual(["openai", "commandcode", "google"])
  })

  test("provider is the first path segment even for namespaced ids", () => {
    expect(providerOf("openrouter/anthropic/claude-sonnet-4")).toBe("openrouter")
  })

  test("model reference validation matches the config schema", () => {
    expect(isModelReference("openai/gpt-5.6-sol")).toBe(true)
    expect(isModelReference("openrouter/anthropic/claude-sonnet-4")).toBe(true)
    expect(isModelReference("no-slash")).toBe(false)
    expect(isModelReference("has space/model")).toBe(false)
  })
})
