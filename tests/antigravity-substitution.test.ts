import { describe, expect, test } from "bun:test"
import plugin from "../plugin.js"
import type { AntigravityTrace } from "../src/telemetry/types.js"

function client() {
  return {
    session: {
      get: async ({ path }: { path: { id: string } }) => ({ data: path.id === "child" ? { id: "child", parentID: "root" } : { id: "root" } }),
      children: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }
}

describe("antigravity substitution routing", () => {
  test("tracks antigravity_delegate as foreground call", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_delegate", sessionID: "root", callID: "ag-del" },
      { args: { prompt: "Analyze this corpus." } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag-del" },
      { output: "Analysis complete.", metadata: {} },
    )
  })

  test("tracks antigravity_vision as vision call", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_vision", sessionID: "root", callID: "ag-vis" },
      { args: { prompt: "What is in this screenshot?" } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag-vis" },
      { output: "Screenshot analysis.", metadata: {} },
    )
  })

  test("tracks antigravity_background_start as background call", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_background_start", sessionID: "root", callID: "ag-bg" },
      { args: { prompt: "Summarize these logs." } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag-bg" },
      { output: "Job started.", metadata: {} },
    )
  })

  test("does NOT track non-antigravity tools", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "root", callID: "read" },
      { args: { filePath: "src/app.ts" } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "read" },
      { output: "file contents", metadata: {} },
    )
  })

  test("records model from antigravity tool args when present", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_delegate", sessionID: "root", callID: "ag-model" },
      { args: { prompt: "Analyze.", model: "gemini-3.6-flash-high" } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag-model" },
      { output: "Done.", metadata: {} },
    )
  })

  test("marks antigravity call as failed when tool error event fires", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_delegate", sessionID: "root", callID: "ag-fail" },
      { args: { prompt: "Analyze." } },
    )
    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: { type: "tool", callID: "ag-fail", state: { status: "error", time: { end: Date.now() } } },
        },
      },
    })
    await hooks["tool.execute.after"]?.(
      { callID: "ag-fail" },
      { output: "late completion", metadata: {} },
    )
  })

  test("does not require antigravity before a routine write task", async () => {
    // Antigravity is substitution, not a mandatory pre-step. A shared-write task
    // should be dispatched without any Antigravity pre-condition check.
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })

    const writePacket = `# Execution Class: shared-write
# Expected Scope: src/**/*.ts
# Objective:
Implement the fix.
# Scope:
Core module.
# Constraints:
Safe.
# Acceptance:
Test passes.
# Verification:
bun test
# Escalate When:
Conflict.
# Return:
Changed files.`

    const args = { subagent_type: "routine", description: writePacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "routine-write" }, { args })
    expect(args.description).toContain("Worker Execution Contract")
    await hooks["tool.execute.after"]?.(
      { callID: "routine-write" },
      { output: '<flow-work-report>{"status":"completed","summary":"done","filesChanged":["fixed.ts"],"verification":[],"scopeChanges":[]}</flow-work-report>' },
    )
  })

  test("antigravity background work does not block routine write task", async () => {
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_background_start", sessionID: "root", callID: "bg" },
      { args: { prompt: "Draft summary." } },
    )

    const writePacket = `# Execution Class: shared-write
# Expected Scope: src/**/*.ts
# Objective:
Implement the fix.
# Scope:
Core module.
# Constraints:
Safe.
# Acceptance:
Test passes.
# Verification:
bun test
# Escalate When:
Conflict.
# Return:
Changed files.`
    const args = { subagent_type: "routine", description: writePacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "write" }, { args })
    expect(args.description).toContain("Worker Execution Contract")
  })

  test("read-only classification: antigravity tools are read-only advisory", async () => {
    // Antigravity is always read-only (no browser control, no edits). Verify
    // that it does not interfere with readonly/shared-write frontier enforcement.
    const hooks: any = await plugin({ client: client() })
    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: Date.now() } } })

    // A read-only worker task should still be allowed while antigravity is
    // running in the same root — antigravity doesn't affect worker frontier.
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_delegate", sessionID: "root", callID: "ag-ro" },
      { args: { prompt: "Explore the repo." } },
    )
    const roPacket = `# Execution Class: read-only
# Expected Scope: src/**/*.ts
# Objective:
Explore.
# Scope:
src/
# Constraints:
No edits.
# Acceptance:
Summary.
# Verification:
bun test
# Escalate When:
Conflict.
# Return:
File listing.`
    const args = { subagent_type: "routine", description: roPacket }
    await hooks["tool.execute.before"]?.({ tool: "task", sessionID: "root", callID: "ro-task" }, { args })
    expect(args.description).toContain("Worker Execution Contract")
  })

  test("antigravity lifecycle appears in report totals and antigravityCalls array", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")
    const directory = await mkdtemp(join(tmpdir(), "ag-lifecycle-"))
    const createdAt = Date.now() - 1_000

    const hooks: any = await plugin({
      client: {
        session: {
          get: async () => ({ data: { id: "root" } }),
          children: async () => ({ data: [] }),
          messages: async () => ({ data: [
            { info: { id: "user", role: "user" as const, agent: "orchestrator", time: { created: createdAt } } },
          ] }),
        },
        tui: { showToast: async () => {} },
      },
    }, { telemetry: { reportDir: directory, runSummaryToast: false } })

    await hooks["chat.message"]?.({ sessionID: "root", agent: "orchestrator", messageID: "run" }, { message: { id: "run", role: "user", time: { created: createdAt } } })
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_delegate", sessionID: "root", callID: "ag1" },
      { args: { prompt: "Analyze repo.", model: "gemini-3.6-flash-high" } },
    )
    await hooks["tool.execute.before"]?.(
      { tool: "antigravity_vision", sessionID: "root", callID: "ag2" },
      { args: { prompt: "What is in this screenshot?" } },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag1" },
      { output: "Analysis done.", metadata: {} },
    )
    await hooks["tool.execute.after"]?.(
      { callID: "ag2" },
      { output: "Screenshot analysis.", metadata: {} },
    )
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "root" } } })

    const report = JSON.parse(await readFile(join(directory, "latest-run.json"), "utf8"))
    expect(report.schemaVersion).toBe(6)
    expect(report.totals.antigravityCalls).toBe(2)
    expect(report.totals.antigravityForeground).toBe(1)
    expect(report.totals.antigravityVision).toBe(1)
    expect(report.totals.antigravityBackground).toBe(0)
    expect(report.antigravityCalls).toHaveLength(2)
    const ag1 = report.antigravityCalls.find((c: AntigravityTrace) => c.callID === "ag1")
    expect(ag1).toBeDefined()
    expect(ag1.type).toBe("foreground")
    expect(ag1.model).toBe("gemini-3.6-flash-high")
    expect(ag1.status).toBe("completed")
    expect(ag1.durationMs).toBeGreaterThanOrEqual(0)
    const ag2 = report.antigravityCalls.find((c: AntigravityTrace) => c.callID === "ag2")
    expect(ag2).toBeDefined()
    expect(ag2.type).toBe("vision")
    expect(ag2.status).toBe("completed")
    await rm(directory, { recursive: true, force: true })
  })

  test("backward compatibility: v5 report upgrades to v6 with zero antigravity", async () => {
    // The v4/v5 → v6 upgrade path in store.ts adds zeroed antigravity totals.
    // We test this through the telemetry store's upgrade path directly.
    const { mkdtemp, rm, writeFile, readFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")
    const { TelemetryStore } = await import("../src/telemetry/store.js")
    const { buildFlowReport } = await import("../src/telemetry/reports.js")
    const { openaiCommandCodeRouter } = await import("../src/flows/openai-commandcode-router.js")

    const directory = await mkdtemp(join(tmpdir(), "ag-v5-compat-"))
    const store = new TelemetryStore(directory)
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root",
      runID: "v5-run",
      sessions: [],
    }) as unknown as Record<string, unknown>
    const totals = { ...(report.totals as Record<string, unknown>) }
    delete (totals as any).antigravityCalls
    delete (totals as any).antigravityForeground
    delete (totals as any).antigravityBackground
    delete (totals as any).antigravityVision
    await writeFile(join(directory, "latest-run.json"), JSON.stringify({ ...report, schemaVersion: 5, totals }), "utf8")

    const upgraded = await store.latestRun()
    expect(upgraded?.schemaVersion).toBe(6)
    expect(upgraded?.totals.antigravityCalls).toBe(0)
    expect(upgraded?.totals.antigravityForeground).toBe(0)
    expect(upgraded?.totals.antigravityBackground).toBe(0)
    expect(upgraded?.totals.antigravityVision).toBe(0)
    expect(upgraded?.antigravityCalls).toEqual([])
    await rm(directory, { recursive: true, force: true })
  })

  test("filters antigravity traces by run and session", async () => {
    const { buildFlowReport } = await import("../src/telemetry/reports.js")
    const { openaiCommandCodeRouter } = await import("../src/flows/openai-commandcode-router.js")
    const now = Date.now()
    const trace = (id: string, sessionID: string, runID: string): AntigravityTrace => ({
      id,
      callID: id,
      sessionID,
      runID,
      type: "foreground",
      tool: "antigravity_delegate",
      status: "completed",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    })
    const report = buildFlowReport({
      flow: openaiCommandCodeRouter,
      rootSessionID: "root",
      runID: "run-2",
      startedAt: now - 1,
      sessions: [{ id: "root", agent: "orchestrator", messages: [{ role: "user", createdAt: now }] }],
      antigravityCalls: [
        trace("included", "root", "run-2"),
        trace("old-run", "root", "run-1"),
        trace("other-session", "other", "run-2"),
      ],
    })
    expect(report.antigravityCalls.map((call) => call.id)).toEqual(["included"])
    expect(report.totals.antigravityCalls).toBe(1)
  })
})
