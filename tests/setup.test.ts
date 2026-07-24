import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin.js"

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function stateDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "flow-setup-"))
  directories.push(directory)
  return directory
}

const roles = JSON.stringify({
  orchestrator: { model: "openai/gpt-5.6-sol", variant: "low", billingSource: "subscription-flat", effectiveCostNote: "ChatGPT Plus" },
  routine: { model: "commandcode/deepseek-v4-pro", variant: "high", billingSource: "credit-pool" },
  bulk: { model: "google/gemini-3.6-flash", billingSource: "bundled-credit", effectiveCostNote: "Antigravity credits" },
})

describe("orchestration setup tools", () => {
  test("flow_config reports when nothing is configured", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    const output = await hooks.tool.flow_config.execute({})
    expect(output).toContain("No configuration is saved")
    expect(output).toContain("flow-setup")
  })

  test("flow_configure persists roles and flow_config renders them", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    const saved = await hooks.tool.flow_configure.execute({ roles, title: "My setup" })
    expect(saved).toContain("Saved")

    const view = await hooks.tool.flow_config.execute({})
    expect(view).toContain("My setup")
    expect(view).toContain("openai/gpt-5.6-sol")
    expect(view).toContain("subscription-flat")
    expect(view).toContain("Antigravity credits")
    // bulk is explicit; reviewer inherits routine.
    expect(view).toContain("inherits routine")
    // Not active until flow: "custom" is selected.
    expect(view).toContain("NOT active")
  })

  test("marks the configuration active when the custom flow is selected", async () => {
    const directory = await stateDir()
    const setup: any = await plugin({}, { telemetry: { reportDir: directory } })
    await setup.tool.flow_configure.execute({ roles })

    const hooks: any = await plugin({}, { flow: "custom", telemetry: { reportDir: directory } })
    expect(await hooks.tool.flow_config.execute({})).toContain("Status: active")
  })

  test("updates a single role without disturbing the others", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    await hooks.tool.flow_configure.execute({ roles })
    await hooks.tool.flow_configure.execute({ role: "reviewer", model: "commandcode/mimo-v2.5-pro", billingSource: "credit-pool" })

    const view = await hooks.tool.flow_config.execute({})
    expect(view).toContain("commandcode/mimo-v2.5-pro")
    expect(view).toContain("openai/gpt-5.6-sol")
    expect(view).not.toContain("reviewer | commandcode/deepseek-v4-pro")
  })

  test("validates roles, models, and billing sources", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    await expect(hooks.tool.flow_configure.execute({ role: "nonsense", model: "a/b" })).rejects.toThrow(/Unknown role/)
    await expect(hooks.tool.flow_configure.execute({ role: "routine" })).rejects.toThrow(/model is required/)
    await expect(hooks.tool.flow_configure.execute({ role: "routine", model: "a/b", billingSource: "free-lunch" })).rejects.toThrow(/Unknown billingSource/)
    await expect(hooks.tool.flow_configure.execute({ roles: "{not json" })).rejects.toThrow(/JSON object/)
    // A config missing required roles is rejected rather than half-saved.
    await expect(hooks.tool.flow_configure.execute({ roles: JSON.stringify({ bulk: { model: "a/b" } }) })).rejects.toThrow(/orchestrator/)
  })

  test("reset removes the saved configuration", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    await hooks.tool.flow_configure.execute({ roles })
    expect(await hooks.tool.flow_configure.execute({ reset: true })).toContain("Removed")
    expect(await hooks.tool.flow_config.execute({})).toContain("No configuration is saved")
  })

  test("registers the setup and config commands", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    const config: Record<string, any> = {}
    await hooks.config(config)
    expect(config.command["flow-setup"].template).toContain("effective cost")
    expect(config.command["flow-setup"].template).toContain("bundled-credit")
    expect(config.command["flow-config"].template).toContain("flow_config")
  })

  test("does not overwrite user-defined commands", async () => {
    const directory = await stateDir()
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    const config: Record<string, any> = { command: { "flow-setup": { template: "mine" } } }
    await hooks.config(config)
    expect(config.command["flow-setup"].template).toBe("mine")
  })
})

describe("custom flow end to end", () => {
  test("builds agents from the saved configuration", async () => {
    const directory = await stateDir()
    const setup: any = await plugin({}, { telemetry: { reportDir: directory } })
    await setup.tool.flow_configure.execute({ roles })

    const hooks: any = await plugin({}, { flow: "custom", telemetry: { reportDir: directory } })
    const config: Record<string, any> = {}
    await hooks.config(config)
    expect(config.agent.orchestrator.model).toBe("openai/gpt-5.6-sol")
    expect(config.agent.routine.model).toBe("commandcode/deepseek-v4-pro")
    expect(config.agent.bulk.model).toBe("google/gemini-3.6-flash")
    // Inherited roles resolve, and guardrails stay plugin-owned.
    expect(config.agent.reviewer.model).toBe("commandcode/deepseek-v4-pro")
    expect(config.agent.reviewer.permission.edit).toBe("deny")
    expect(config.default_agent).toBe("orchestrator")
  })

  test("selecting the custom flow without a configuration degrades instead of failing", async () => {
    // Throwing here would unregister every tool, including the flow_configure
    // the error tells the user to run. Degrade to the built-in flow instead.
    const directory = await stateDir()
    const hooks: any = await plugin({}, { flow: "custom", telemetry: { reportDir: directory } })
    const view = await hooks.tool.flow_config.execute({})
    expect(view).toContain("could not be loaded")
    expect(view).toMatch(/setup skill|flow_configure|flow-setup/)
  })

  test("still rejects unknown flow names", async () => {
    const directory = await stateDir()
    await expect(plugin({}, { flow: "missing", telemetry: { reportDir: directory } })).rejects.toThrow(/Unknown OpenCode agent flow/)
  })
})
