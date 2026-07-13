import { describe, expect, test } from "bun:test"
import plugin from "../plugin.js"

describe("agent flows plugin", () => {
  test("registers the best-of-both-worlds flow", async () => {
    const hooks = await plugin({}, { setDefault: true })
    const config: Record<string, any> = {}
    await hooks.config(config)

    expect(config.default_agent).toBe("orchestrator")
    expect(config.agent.orchestrator.model).toBe("openai/gpt-5.6-sol")
    expect(config.agent.orchestrator.variant).toBe("low")
    expect(config.agent.routine.model).toBe("commandcode/deepseek-v4-pro")
    expect(config.agent.deep.model).toBe("openai/gpt-5.6-sol")
  })

  test("preserves user agent overrides and existing default", async () => {
    const hooks = await plugin({}, { setDefault: true })
    const config: Record<string, any> = {
      default_agent: "build",
      agent: { routine: { model: "custom/model" } },
    }
    await hooks.config(config)

    expect(config.default_agent).toBe("build")
    expect(config.agent.routine.model).toBe("custom/model")
    expect(config.agent.deep).toBeDefined()
  })

  test("rejects unknown flows", async () => {
    await expect(plugin({}, { flow: "missing" })).rejects.toThrow("Unknown OpenCode agent flow")
  })
})
