import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin.js"

const temporaryDirectories: string[] = []
const workPacket = `# Objective:
Implement the requested behavior.
# Scope:
Use the relevant module only.
# Constraints:
Follow repository conventions.
# Acceptance:
The focused test passes.
# Verification:
bun test
# Escalate When:
Requirements conflict.
# Return:
Changed files and evidence.`
const markdownWorkPacket = workPacket.replaceAll(":\n", "\n")

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("agent flows plugin", () => {
  test("registers the openai-commandcode-router flow", async () => {
    const hooks = await plugin({}, { flow: "openai-commandcode-router", setDefault: true })
    const config: Record<string, any> = {}
    await hooks.config(config)

    expect(config.default_agent).toBe("orchestrator")
    expect(config.agent.orchestrator.model).toBe("openai/gpt-5.6-sol")
    expect(config.agent.orchestrator.variant).toBe("low")
    expect(config.agent.bulk.model).toBe("commandcode/mimo-v2.5")
    expect(config.agent.routine.model).toBe("commandcode/deepseek-v4-pro")
    expect(config.agent.routine.variant).toBe("high")
    expect(config.agent.reviewer.model).toBe("commandcode/mimo-v2.5-pro")
    expect(config.agent.deep.model).toBe("openai/gpt-5.6-terra")
    expect(config.agent.deep.variant).toBe("high")
    expect(config.agent.deep.description).toContain("Escalation-only")
    expect(config.agent.orchestrator.prompt).toContain("completion loop")
    expect(config.agent.orchestrator.prompt).toContain("different model family")
    expect(config.agent.orchestrator.prompt).toContain("no independent cross-family reviewer")
    expect(config.agent.orchestrator.prompt).toContain("Agent or general-purpose subagents")
    expect(config.agent.orchestrator.prompt).toContain("concrete failed or blocked result")
    expect(config.agent.orchestrator.prompt).toContain("surface-level and cheap")
    expect(config.agent.orchestrator.prompt).toContain("worker owns repository exploration")
    expect(config.agent.orchestrator.permission).toBeDefined()
    expect(config.agent.routine.permission.task).toBe("deny")
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

  test("registers evaluators once and persists runtime developer-mode changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-developer-"))
    temporaryDirectories.push(directory)
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    const config: Record<string, any> = {}
    await hooks.config(config)

    expect(config.agent["flow-audit-reviewer"]).toBeDefined()
    const result = await hooks.tool.flow_developer_mode.execute({
      enabled: true,
      auditReview: true,
      shadowPlanning: false,
      shadowImplementation: true,
      sampleRate: 1,
    })
    expect(result).toContain("enabled")

    const reloaded: any = await plugin({}, { telemetry: { reportDir: directory } })
    const status = await reloaded.tool.flow_developer_mode.execute({})
    expect(status).toContain("audit=true")
    expect(status).toContain("sample rate=1")
  })

  test("rejects unknown flows", async () => {
    await expect(plugin({}, { flow: "missing" })).rejects.toThrow("Unknown OpenCode agent flow")
  })

  test("enforces the configured per-run worker attempt limit", async () => {
    const hooks = await plugin({
      client: {
        session: {
          get: async () => ({ data: { id: "root" } }),
          children: async () => ({ data: [] }),
          messages: async () => ({ data: [] }),
        },
      },
    })
    await hooks["chat.message"]?.(
      { sessionID: "root", agent: "orchestrator", messageID: "run" },
      { message: { id: "run", role: "user", time: { created: Date.now() } } },
    )
    const args = { subagent_type: "routine", description: workPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "one" }, { args })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "two" }, { args })

    await expect(
      hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "three" }, { args }),
    ).rejects.toThrow("2-attempt limit")
  })

  test("requires work packets and flags malformed worker reports", async () => {
    const hooks: any = await plugin({
      client: { session: { get: async () => ({ data: { id: "root" } }), children: async () => ({ data: [] }), messages: async () => ({ data: [] }) } },
    })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "invalid" }, { args: { subagent_type: "routine", description: "Fix it" } })).rejects.toThrow("routine requires a work packet")
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "oversized" }, { args: { subagent_type: "routine", description: `${workPacket}\n${"x".repeat(3_000)}` } })).rejects.toThrow("surface-level planning budget")

    const args = { subagent_type: "routine", description: workPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "valid" }, { args })
    expect(args.description).toContain("Worker Execution Contract")
    const output = { output: "Implemented the change." }
    await hooks["tool.execute.after"]?.({ callID: "valid" }, output)
    expect(output.output).toContain("Flow guardrail")

    const markdownArgs = { subagent_type: "routine", description: markdownWorkPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "markdown" }, { args: markdownArgs })
    expect(markdownArgs.description).toContain("Worker Execution Contract")
  })

  test("requires routine evidence before deep escalation", async () => {
    const hooks: any = await plugin({ client: { session: { get: async () => ({ data: { id: "root" } }), children: async () => ({ data: [] }), messages: async () => ({ data: [] }) } } })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "deep" }, { args: { subagent_type: "deep", description: `${markdownWorkPacket}\n# Escalation Evidence\nArchitecture is difficult.` } })).rejects.toThrow("failed or blocked routine attempt")
  })

  test("technically blocks mutating evaluator tools", async () => {
    const hooks = await plugin({
      client: {
        session: {
          get: async ({ path }: { path: { id: string } }) => ({ data: path.id === "evaluator" ? { id: "evaluator", parentID: "root" } : { id: "root" } }),
          children: async () => ({ data: [] }),
          messages: async () => ({ data: [] }),
        },
      },
    }, { developer: { enabled: true, auditReview: true } })
    await hooks["chat.message"]?.(
      { sessionID: "evaluator", agent: "flow-audit-reviewer", messageID: "eval" },
      { message: { id: "eval", role: "user", time: { created: Date.now() } } },
    )

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "edit", sessionID: "evaluator", callID: "edit" },
        { args: { filePath: "src/app.ts" } },
      ),
    ).rejects.toThrow("read-only")
  })
})
