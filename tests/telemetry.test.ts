import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import plugin from "../plugin.js"
import { openaiCommandCodeRouter } from "../src/flows/openai-commandcode-router.js"
import { buildFlowReport, buildGlobalReport } from "../src/telemetry/reports.js"
import { TelemetryStore } from "../src/telemetry/store.js"
import type { TokenUsage } from "../src/telemetry/types.js"

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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function tokens(input: number, output: number, reasoning = 0, cacheRead = 0): TokenUsage {
  return { input, output, reasoning, cacheRead, cacheWrite: 0 }
}

describe("model-independent telemetry", () => {
  test("classifies offload from flow billing metadata rather than provider names", () => {
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root",
      runID: "run-1",
      sessions: [
        {
          id: "root",
          agent: "orchestrator",
          messages: [{ role: "assistant", providerID: "any-provider", modelID: "baseline", tokens: tokens(1_000, 100) }],
        },
        {
          id: "child",
          parentID: "root",
          agent: "bulk",
          messages: [{ role: "assistant", providerID: "same-or-different", modelID: "worker", tokens: tokens(3_000, 300), costUsd: 0.02 }],
        },
      ],
    })

    expect(report.totals.subagentsSpawned).toBe(1)
    expect(report.totals.costUsd).toBe(0.02)
    expect(report.estimate.observedBaselineOffloadPct).toBe(75)
    expect(report.estimate.estimatedBaselineUsageReductionPct).toBe(56.25)
    expect(report.estimate.estimatedCapacityMultiplier).toBe(2.29)
    expect(report.byAgent.find((agent) => agent.agent === "bulk")?.billingSource).toBe("commandcode-credits")
  })

  test("filters evidence to the reported session tree", () => {
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root-a",
      sessions: [{ id: "root-a", agent: "orchestrator", messages: [{ role: "user" }] }],
      tasks: [
        { id: "a", callID: "a", sessionID: "root-a", status: "completed", startedAt: 1, linkConfidence: "correlated" },
        { id: "b", callID: "b", sessionID: "root-b", status: "failed", startedAt: 1, linkConfidence: "correlated" },
      ],
      verification: [
        { id: "va", sessionID: "root-a", command: "bun test", category: "test", status: "passed", observedAt: 1 },
        { id: "vb", sessionID: "root-b", command: "bun test", category: "test", status: "failed", observedAt: 1 },
      ],
    })

    expect(report.totals.tasksStarted).toBe(1)
    expect(report.totals.taskFailures).toBe(0)
    expect(report.totals.verificationRuns).toBe(1)
    expect(report.totals.verificationFailures).toBe(0)
  })

  test("reports configured API-equivalent pricing for subscription-backed calls", () => {
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root",
      sessions: [{
        id: "root",
        agent: "orchestrator",
        messages: [{ role: "assistant", providerID: "openai", modelID: "gpt-5.6-sol", tokens: tokens(1_000_000, 500_000) }],
      }],
      pricing: { "openai/gpt-5.6-sol": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 } },
    })

    expect(report.totals.costUsd).toBe(0)
    expect(report.totals.apiEquivalentCostUsd).toBe(20)
    expect(report.totals.apiEquivalentPricedCalls).toBe(1)
    expect(report.byModel[0]?.apiEquivalentCostUsd).toBe(20)
  })

  test("materializes run, session, global, markdown, and dashboard reports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-store-"))
    temporaryDirectories.push(directory)
    const store = new TelemetryStore(directory)
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root",
      runID: "run-1",
      startedAt: Date.now() - 1_000,
      sessions: [{
        id: "root",
        agent: "orchestrator",
        messages: [{ role: "assistant", providerID: "openai", modelID: "baseline", tokens: tokens(100, 10) }],
      }],
    })

    const global = await store.writeReport(report)
    expect(global.runs).toBe(1)
    expect(await readFile(join(directory, "latest-run.md"), "utf8")).toContain("Run Report")
    expect(await readFile(join(directory, "latest-run.md"), "utf8")).toContain("Time used")
    const dashboard = await readFile(join(directory, "dashboard.html"), "utf8")
    expect(dashboard).toContain("Agent Flow Observatory")
    expect(dashboard).toContain("Model costs — selected run")
    expect(dashboard).toContain("data-run")
    expect(report.durationMs).toBeGreaterThanOrEqual(1_000)
    expect(buildGlobalReport([report]).averageDurationMs).toBe(report.durationMs)
  })

  test("respects dashboard and retention settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-retention-"))
    temporaryDirectories.push(directory)
    const store = new TelemetryStore(directory, { dashboard: false, retentionDays: 1 })
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "old-root",
      runID: "old-run",
      sessions: [],
    })
    report.completedAt = Date.now() - 2 * 24 * 60 * 60 * 1_000

    await store.writeReport(report)
    expect(await store.listRuns()).toHaveLength(0)
    await expect(readFile(join(directory, "dashboard.html"), "utf8")).rejects.toThrow()
  })

  test("retrieves run and session reports by root session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-scope-"))
    temporaryDirectories.push(directory)
    const store = new TelemetryStore(directory)
    for (const rootSessionID of ["root-a", "root-b"]) {
      const run = buildFlowReport({
        flow: openaiCommandCodeRouter,
        rootSessionID,
        runID: `run-${rootSessionID}`,
        sessions: [{ id: rootSessionID, agent: "orchestrator", messages: [{ role: "user" }] }],
      })
      await store.writeReport(run)
      await store.writeReport(buildFlowReport({
        flow: openaiCommandCodeRouter,
        rootSessionID,
        sessions: [{ id: rootSessionID, agent: "orchestrator", messages: [{ role: "user" }] }],
      }))
    }

    expect((await store.latestRunForSession("root-a"))?.runID).toBe("run-root-a")
    expect((await store.session("root-a"))?.rootSessionID).toBe("root-a")
  })

  test("tracks a root turn and emits a report after the full run becomes idle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-flow-runtime-"))
    temporaryDirectories.push(directory)
    const toasts: unknown[] = []
    const createdAt = Date.now()
    const hooks = await plugin(
      {
        client: {
          session: {
          get: async ({ path }: { path: { id: string } }) => ({ data: path.id === "child" ? { id: "child", parentID: "root" } : { id: "root" } }),
          children: async ({ path }: { path: { id: string } }) => ({ data: path.id === "root" ? [{ id: "child", parentID: "root" }] : [] }),
          messages: async ({ path }: { path: { id: string } }) => ({
              data: path.id === "root"
                ? [
                    { info: { id: "user", role: "user" as const, agent: "orchestrator", time: { created: createdAt } } },
                    { info: { id: "assistant", role: "assistant" as const, agent: "orchestrator", providerID: "openai", modelID: "gpt", cost: 0, tokens: { input: 1_000, output: 100 }, time: { created: createdAt + 1 } } },
                  ]
                : [
                    { info: { id: "child-user", role: "user" as const, agent: "routine", time: { created: createdAt + 2 } } },
                    { info: { id: "child-assistant", role: "assistant" as const, agent: "routine", providerID: "commandcode", modelID: "worker", cost: 0.01, tokens: { input: 2_000, output: 200 }, time: { created: createdAt + 3 } } },
                  ],
            }),
          },
          tui: { showToast: async (toast: unknown) => void toasts.push(toast) },
        },
      },
      { telemetry: { reportDir: directory }, quota: { commandCodeMonthlyCreditsUsd: 10 } },
    )

    await hooks["chat.message"]?.(
      { sessionID: "root", agent: "orchestrator", messageID: "run-1" },
      { message: { id: "run-1", role: "user", time: { created: createdAt } } },
    )
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "task-1" },
      { args: { subagent_type: "routine", description: workPacket } },
    )
    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "root", callID: "task-1", args: {} },
      { output: "complete", metadata: {} },
    )
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "root", callID: "task-failed" },
      { args: { subagent_type: "routine", description: workPacket } },
    )
    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: { type: "tool", callID: "task-failed", state: { status: "error", time: { end: Date.now() } } },
        },
      },
    })
    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "root", callID: "task-failed", args: {} },
      { output: "failed", metadata: {} },
    )
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "root", callID: "test-failed" },
      { args: { command: "bun test" } },
    )
    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: { type: "tool", callID: "test-failed", state: { status: "error", time: { end: Date.now() } } },
        },
      },
    })
    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "root", callID: "test-failed", args: { command: "bun test" } },
      { output: "failed", metadata: {} },
    )
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "root" } } })

    const report = JSON.parse(await readFile(join(directory, "latest-run.json"), "utf8"))
    expect(report.runID).toBe("run-1")
    expect(report.totals.subagentsSpawned).toBe(1)
    expect(report.totals.tasksCompleted).toBe(1)
    expect(report.totals.taskFailures).toBe(1)
    expect(report.totals.verificationFailures).toBe(1)
    expect(toasts).toHaveLength(1)
  })
})
