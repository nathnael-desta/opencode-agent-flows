import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
const reviewPacket = `# Review Milestone:
Substantial reliability changes before handoff.
# Acceptance:
Budgets and failure states are enforced.
# Change Set:
Review the supplied plugin diff.
# Verification:
bun test and tsc --noEmit passed.
# Risk:
standard`

function client() {
  return {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({ data: path.id === "child" ? { id: "child", parentID: "root" } : { id: "root" } }),
      children: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }
}

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
    expect(config.agent.orchestrator.prompt).toContain("bounded unit")
    expect(config.agent.orchestrator.prompt).toContain("milestone gate")
    expect(config.agent.orchestrator.prompt).toContain("stop after two total rounds")
    expect(config.agent.orchestrator.prompt).toContain("Dispatch up to three")
    expect(config.agent.orchestrator.prompt).toContain("different model family")
    expect(config.agent.orchestrator.prompt).toContain("no independent cross-family reviewer")
    expect(config.agent.orchestrator.prompt).toContain("Agent or general-purpose subagents")
    expect(config.agent.orchestrator.prompt).toContain("concrete failed or blocked result")
    expect(config.agent.orchestrator.prompt).toContain("surface-level and cheap")
    expect(config.agent.orchestrator.prompt).toContain("worker owns repository exploration")
    expect(config.agent.orchestrator.permission).toBeDefined()
    expect(config.agent.routine.permission.task).toBe("deny")
    expect(config.agent.orchestrator.steps).toBe(30)
    expect(config.agent.reviewer.steps).toBe(12)
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

  test("persists model overrides for the next OpenCode startup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-models-"))
    temporaryDirectories.push(directory)
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    expect(await hooks.tool.flow_models.execute({})).toContain("routine: commandcode/deepseek-v4-pro")
    expect(await hooks.tool.flow_models.execute({ agent: "routine", model: "commandcode/laguna-s-2.1-free" })).toContain("Restart OpenCode")

    const reloaded: any = await plugin({}, { telemetry: { reportDir: directory } })
    const config: Record<string, any> = {}
    await reloaded.config(config)
    expect(config.agent.routine.model).toBe("commandcode/laguna-s-2.1-free")
    expect(config.agent.routine.variant).toBeUndefined()

    await reloaded.tool.flow_models.execute({ agent: "routine", reset: true })
    const reset: any = await plugin({}, { telemetry: { reportDir: directory } })
    const resetConfig: Record<string, any> = {}
    await reset.config(resetConfig)
    expect(resetConfig.agent.routine.model).toBe("commandcode/deepseek-v4-pro")
    expect(resetConfig.agent.routine.variant).toBe("high")
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
    await hooks["tool.execute.after"]?.({ callID: "one" }, { output: '<flow-work-report>{"status":"completed","summary":"first","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "two" }, { args })
    await hooks["tool.execute.after"]?.({ callID: "two" }, { output: '<flow-work-report>{"status":"completed","summary":"second","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' })

    await expect(
      hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "three" }, { args }),
    ).rejects.toThrow("2-attempt limit")
  })

  test("keys retries by stable Task ID instead of mutable packet wording", async () => {
    const hooks: any = await plugin({ client: client() }, { verification: { maxWorkerAttempts: 1 } })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "one" },
      { args: { subagent_type: "routine", description: `# Task ID: parser-fix\n${workPacket}` } },
    )
    await hooks["tool.execute.after"]?.({ callID: "one" }, { output: '<flow-work-report>{"status":"completed","summary":"done","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' })
    await expect(hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "two" },
      { args: { subagent_type: "routine", description: `# Task ID: parser-fix\n${workPacket.replace("requested behavior", "same parser behavior with different wording")}` } },
    )).rejects.toThrow("task parser-fix")
  })

  test("enforces task and concurrent worker budgets", async () => {
    const hooks: any = await plugin(
      { client: client() },
      { orchestration: { maxTasksPerRun: 2, maxConcurrentWorkers: 1 }, verification: { maxWorkerAttempts: 5 } },
    )
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "one" }, { args: { subagent_type: "routine", description: `# Task ID: one\n${workPacket}` } })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "concurrent" }, { args: { subagent_type: "routine", description: `# Task ID: two\n${workPacket}` } })).rejects.toThrow("concurrency limit")
    await hooks["tool.execute.after"]?.({ callID: "one" }, { output: '<flow-work-report>{"status":"completed","summary":"done","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "two" }, { args: { subagent_type: "routine", description: `# Task ID: two\n${workPacket}` } })
    await hooks["tool.execute.after"]?.({ callID: "two" }, { output: '<flow-work-report>{"status":"completed","summary":"done","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "three" }, { args: { subagent_type: "routine", description: `# Task ID: three\n${workPacket}` } })).rejects.toThrow("2-task delegation budget")
  })

  test("enforces compact milestone review packets and a two-round ceiling", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await expect(hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "bad-review" },
      { args: { subagent_type: "reviewer", description: "Review this." } },
    )).rejects.toThrow("missing headings")

    const first = { subagent_type: "reviewer", description: reviewPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "review-one" }, { args: first })
    expect(first.description).toContain("Review Execution Contract")
    await hooks["tool.execute.after"]?.(
      { callID: "review-one" },
      { output: '<flow-review>{"verdict":"changes-requested","summary":"one bug","findings":[{"severity":"high","title":"Bug","evidence":"Concrete failure","verification":"bun test"}]}</flow-review>' },
    )
    await expect(hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "review-two-missing" },
      { args: { subagent_type: "reviewer", description: reviewPacket } },
    )).rejects.toThrow("second review requires headings")

    const secondDescription = `${reviewPacket}\n# Finding Disposition:\nAgreed and fixed Bug.\n# Non-trivial Fixes:\nChanged task status handling.`
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "review-two" }, { args: { subagent_type: "reviewer", description: secondDescription } })
    await hooks["tool.execute.after"]?.({ callID: "review-two" }, { output: '<flow-review>{"verdict":"pass","summary":"fixed","findings":[]}</flow-review>' })
    await expect(hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "review-three" },
      { args: { subagent_type: "reviewer", description: secondDescription } },
    )).rejects.toThrow("2-round limit")
  })

  test("matches protected path segments without blocking translations", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "child", agent: "routine", messageID: "child-message" }, { message: { id: "child-message", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "read", sessionID: "child", callID: "auth-read" }, { args: { filePath: "src/auth/session.ts" } })
    await hooks["tool.execute.before"]?.({ tool: "edit", sessionID: "child", callID: "translations" }, { args: { filePath: "src/translations.py" } })
    await expect(hooks["tool.execute.before"]?.(
      { tool: "edit", sessionID: "child", callID: "auth" },
      { args: { filePath: "src/auth/session.ts" } },
    )).rejects.toThrow("matched auth")
  })

  test("caps routine packets and flags malformed worker reports", async () => {
    const hooks: any = await plugin({
      client: { session: { get: async () => ({ data: { id: "root" } }), children: async () => ({ data: [] }), messages: async () => ({ data: [] }) } },
    })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "oversized" }, { args: { subagent_type: "routine", description: `${workPacket}\n${"x".repeat(3_000)}` } })).rejects.toThrow("surface-level planning budget")

    const args = { subagent_type: "routine", description: workPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "valid" }, { args })
    expect(args.description).toContain("Worker Execution Contract")
    const output = { output: "Implemented the change." }
    await hooks["tool.execute.after"]?.({ callID: "valid" }, output)
    expect(output.output).toContain("Flow guardrail")

    const conciseArgs = { subagent_type: "routine", description: "Implement the approved R2 milestone and stop if its constraints cannot be met." }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "concise" }, { args: conciseArgs })
    expect(conciseArgs.description).toContain("Worker Execution Contract")
  })

  test("surfaces persisted child model errors for empty task output", async () => {
    const hooks: any = await plugin({
      client: {
        session: {
          get: async () => ({ data: { id: "root" } }),
          children: async () => ({ data: [{ id: "child", parentID: "root" }] }),
          messages: async ({ path }: { path: { id: string } }) => ({
            data: path.id === "child"
              ? [{ info: { role: "assistant", time: { created: Date.now() }, error: { name: "ProviderError", data: { message: "weekly usage limit reached" } } } }]
              : [],
          }),
        },
      },
    })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() - 10 } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "empty" }, { args: { subagent_type: "routine", description: workPacket } })
    const output = { output: "" }
    await hooks["tool.execute.after"]?.({ callID: "empty" }, output)

    expect(output.output).toContain("weekly usage limit reached")
    expect(output.output).toContain("Flow task failure")
  })

  test("requires routine evidence before deep escalation", async () => {
    const hooks: any = await plugin({ client: { session: { get: async () => ({ data: { id: "root" } }), children: async () => ({ data: [] }), messages: async () => ({ data: [] }) } } })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "deep" }, { args: { subagent_type: "deep", description: "Architecture is difficult." } })).rejects.toThrow("failed or blocked routine attempt")
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "malformed" }, { args: { subagent_type: "routine", description: workPacket } })
    await hooks["tool.execute.after"]?.({ callID: "malformed" }, { output: "Substantive prose without a report marker." })
    await expect(hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "deep-after-invalid" }, { args: { subagent_type: "deep", description: "The report was malformed." } })).rejects.toThrow("failed or blocked routine attempt")
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

  test("normalizes work reports with markdown fences and trailing commas", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "fenced" }, { args: { subagent_type: "routine", description: workPacket } })
    const fenced = { output: '```json\n<flow-work-report>{"status":"completed","summary":"done","filesChanged":["a.ts"],"verification":[],"scopeChanges":[],}\n</flow-work-report>\n```' }
    await hooks["tool.execute.after"]?.({ callID: "fenced" }, fenced)
    expect(fenced.output).not.toContain("Flow guardrail")
  })

  test("preserves commas inside JSON string values through normalization", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "string-comma" }, { args: { subagent_type: "routine", description: workPacket } })
    const output = { output: '<flow-work-report>{"status":"completed","summary":"still,working","filesChanged":["x.ts"],"verification":[],"scopeChanges":[],}</flow-work-report>' }
    await hooks["tool.execute.after"]?.({ callID: "string-comma" }, output)
    expect(output.output).not.toContain("Flow guardrail")
  })

  test("understands JAVASCRIPT markdown fences", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "jsfence" }, { args: { subagent_type: "routine", description: workPacket } })
    const fenced = { output: '```JAVASCRIPT\n<flow-work-report>{"status":"completed","summary":"done","filesChanged":["a.ts"],"verification":[],"scopeChanges":[]}\n</flow-work-report>\n```' }
    await hooks["tool.execute.after"]?.({ callID: "jsfence" }, fenced)
    expect(fenced.output).not.toContain("Flow guardrail")
  })

  test("normalizes review reports with trailing commas in findings", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "review" }, { args: { subagent_type: "reviewer", description: reviewPacket } })
    const output = { output: '<flow-review>{"verdict":"changes-requested","summary":"one","findings":[{"severity":"high","title":"Bug","evidence":"crash",}]}</flow-review>' }
    await hooks["tool.execute.after"]?.({ callID: "review" }, output)
    expect(output.output).not.toContain("Flow guardrail")
  })

  test("rejects substantively invalid schemas even after normalization", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "bad" }, { args: { subagent_type: "routine", description: workPacket } })
    const bad = { output: '<flow-work-report>{"status":"ok","summary":"wrong"}</flow-work-report>' }
    await hooks["tool.execute.after"]?.({ callID: "bad" }, bad)
    expect(bad.output).toContain("Flow guardrail")
  })

  test("rejects reports with no filesChanged or verification", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "empty" }, { args: { subagent_type: "routine", description: workPacket } })
    const output = { output: '<flow-work-report>{"status":"completed","summary":"nothing","filesChanged":[],"verification":[],"scopeChanges":[]}</flow-work-report>' }
    await hooks["tool.execute.after"]?.({ callID: "empty" }, output)
    expect(output.output).toContain("Flow guardrail")
  })

  test("preserves startedAt timing across repeated root-session messages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-timing-"))
    temporaryDirectories.push(directory)
    const createdAt = Date.now() - 10_000
    const hooks: any = await plugin({
      client: {
        session: {
          get: async () => ({ data: { id: "root" } }),
          children: async () => ({ data: [] }),
          messages: async () => ({ data: [
            { info: { id: "first", role: "user", agent: "orchestrator", time: { created: createdAt } } },
            { info: { id: "assistant", role: "assistant", agent: "orchestrator", providerID: "openai", modelID: "gpt", tokens: { input: 1, output: 1 }, time: { created: createdAt + 1 } } },
          ] }),
        },
        tui: { showToast: async () => {} },
      },
    }, { telemetry: { reportDir: directory, runSummaryToast: false } })

    await hooks["chat.message"]?.(
      { sessionID: "root", agent: "orchestrator", messageID: "first" },
      { message: { id: "first", role: "user", time: { created: createdAt } } },
    )
    const originalStartedAt = createdAt

    await hooks["chat.message"]?.(
      { sessionID: "root", agent: "orchestrator", messageID: "second" },
      { message: { id: "second", role: "user", time: { created: createdAt + 2000 } } },
    )

    await hooks["chat.message"]?.(
      { sessionID: "root", agent: "orchestrator", messageID: "third" },
      { message: { id: "third", role: "user", time: { created: createdAt + 4000 } } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "timing-task" },
      { args: { subagent_type: "routine", description: workPacket } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "timing-task" },
      { output: '<flow-work-report>{"status":"completed","summary":"done","filesChanged":["fake.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' },
    )
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "root" } } })

    const report = JSON.parse(await readFile(join(directory, "latest-run.json"), "utf8"))
    expect(report.startedAt).toBe(originalStartedAt)
    expect(report.durationMs).toBeGreaterThan(0)
  })

  test("orchestrator prompts contain consolidation, skill, and direct-fix guidance", async () => {
    const hooks = await plugin({}, { flow: "openai-commandcode-router", setDefault: true })
    const config: Record<string, any> = {}
    await hooks.config(config)
    const prompt = config.agent.orchestrator.prompt as string
    expect(prompt).toContain("Skills suggest")
    expect(prompt).toContain("Consolidate multiple review requests")
    expect(prompt).toContain("Reserve direct edits for truly trivial corrections")
    expect(prompt).toContain("first re-delegate the same Task ID")
  })
})
