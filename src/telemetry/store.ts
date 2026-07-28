import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { OrchestrationConfig } from "../orchestration/config.js"
import { renderDashboard } from "./dashboard.js"
import { buildGlobalReport } from "./reports.js"
import { flowReportMarkdown, globalReportMarkdown } from "./markdown.js"
import type { FlowReport, GlobalReport, QualityEvidence, ReportTotals } from "./types.js"

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporaryPath, contents, "utf8")
  await rename(temporaryPath, path)
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

function withParallelismTotals<T extends Record<string, unknown>>(totals: T): T & Pick<ReportTotals, "readOnlyTasks" | "sharedWriteTasks" | "integrationTasks" | "frontierOverlaps"> {
  return {
    ...totals,
    readOnlyTasks: typeof totals.readOnlyTasks === "number" ? totals.readOnlyTasks : 0,
    sharedWriteTasks: typeof totals.sharedWriteTasks === "number" ? totals.sharedWriteTasks : 0,
    integrationTasks: typeof totals.integrationTasks === "number" ? totals.integrationTasks : 0,
    frontierOverlaps: typeof totals.frontierOverlaps === "number" ? totals.frontierOverlaps : 0,
  }
}

function upgradeFlowReport(raw: unknown): FlowReport | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const report = raw as { schemaVersion?: unknown; totals?: unknown } & Record<string, unknown>
  if ((report.schemaVersion !== 4 && report.schemaVersion !== 5) || typeof report.totals !== "object" || report.totals === null) return undefined
  return {
    ...report,
    schemaVersion: 5,
    totals: withParallelismTotals(report.totals as Record<string, unknown>) as unknown as ReportTotals,
  } as FlowReport
}

export class TelemetryStore {
  constructor(
    readonly directory: string,
    readonly options: {
      dashboard?: boolean
      retentionDays?: number
      /** Supplies the saved orchestration config for the dashboard panel. */
      orchestrationConfig?: () => Promise<OrchestrationConfig | undefined>
    } = {},
  ) {}

  private runPath(report: FlowReport): string {
    return join(this.directory, "runs", `${safeName(report.rootSessionID)}-${safeName(report.runID ?? "session")}.json`)
  }

  async writeReport(report: FlowReport): Promise<GlobalReport> {
    const json = `${JSON.stringify(report, null, 2)}\n`
    const markdown = flowReportMarkdown(report)
    if (report.scope === "run") {
      await Promise.all([
        atomicWrite(this.runPath(report), json),
        atomicWrite(join(this.directory, "latest-run.json"), json),
        atomicWrite(join(this.directory, "latest-run.md"), markdown),
      ])
    } else {
      await Promise.all([
        atomicWrite(join(this.directory, "sessions", `${safeName(report.rootSessionID)}.json`), json),
        atomicWrite(join(this.directory, "latest-session.json"), json),
        atomicWrite(join(this.directory, "latest-session.md"), markdown),
      ])
    }
    return this.rebuildGlobal()
  }

  async listRuns(): Promise<FlowReport[]> {
    const directory = join(this.directory, "runs")
    try {
      const files = (await readdir(directory)).filter((file) => file.endsWith(".json"))
      const reports = await Promise.all(files.map(async (file) => ({
        file,
        report: upgradeFlowReport(await readJson<unknown>(join(directory, file))),
      })))
      const retentionMs = this.options.retentionDays === undefined
        ? undefined
        : Math.max(0, this.options.retentionDays) * 24 * 60 * 60 * 1_000
      if (retentionMs !== undefined) {
        await Promise.all(reports
          .filter(({ report }) => report && Date.now() - report.completedAt > retentionMs)
          .map(({ file }) => unlink(join(directory, file)).catch(() => undefined)))
      }
      return reports.map(({ report }) => report)
        .filter((report): report is FlowReport =>
          report?.scope === "run" &&
          (retentionMs === undefined || Date.now() - report.completedAt <= retentionMs),
        )
        .sort((a, b) => a.completedAt - b.completedAt)
    } catch {
      return []
    }
  }

  async rebuildGlobal(): Promise<GlobalReport> {
    const runs = await this.listRuns()
    const global = buildGlobalReport(runs)
    const writes = [
      atomicWrite(join(this.directory, "global.json"), `${JSON.stringify(global, null, 2)}\n`),
      atomicWrite(join(this.directory, "global.md"), globalReportMarkdown(global)),
    ]
    if (this.options.dashboard !== false) {
      const orchestration = await this.options.orchestrationConfig?.().catch(() => undefined)
      writes.push(atomicWrite(join(this.directory, "dashboard.html"), renderDashboard(global, runs, orchestration)))
    }
    await Promise.all(writes)
    return global
  }

  async latestRun(): Promise<FlowReport | undefined> {
    return upgradeFlowReport(await readJson<unknown>(join(this.directory, "latest-run.json")))
  }

  async latestRunForSession(rootSessionID: string): Promise<FlowReport | undefined> {
    const reports = await this.listRuns()
    return reports.filter((report) => report.rootSessionID === rootSessionID).at(-1)
  }

  async latestSession(): Promise<FlowReport | undefined> {
    return upgradeFlowReport(await readJson<unknown>(join(this.directory, "latest-session.json")))
  }

  async session(rootSessionID: string): Promise<FlowReport | undefined> {
    return upgradeFlowReport(await readJson<unknown>(join(this.directory, "sessions", `${safeName(rootSessionID)}.json`)))
  }

  async global(): Promise<GlobalReport> {
    const raw = await readJson<{ schemaVersion: number } & Record<string, unknown>>(join(this.directory, "global.json"))
    if (!raw) return buildGlobalReport([])
    // Backward compatibility: old v1 reports are structurally compatible with
    // v2 totals. Upgrade in-memory on read.
    if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) return buildGlobalReport([])
    return {
      schemaVersion: 2,
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
      runs: typeof raw.runs === "number" ? raw.runs : 0,
      flows: Array.isArray(raw.flows) ? raw.flows as string[] : [],
      totals: withParallelismTotals((raw.totals as Record<string, unknown>) ?? {}) as unknown as GlobalReport["totals"],
      averageEstimatedUsageReductionPct: typeof raw.averageEstimatedUsageReductionPct === "number" ? raw.averageEstimatedUsageReductionPct : 0,
      averageCapacityMultiplier: typeof raw.averageCapacityMultiplier === "number" ? raw.averageCapacityMultiplier : 0,
      averageDurationMs: typeof raw.averageDurationMs === "number" ? raw.averageDurationMs : undefined,
      feedback: (raw.feedback as Record<string, number>) ?? {},
      latestQuotas: Array.isArray(raw.latestQuotas) ? raw.latestQuotas as GlobalReport["latestQuotas"] : [],
    }
  }

  async appendFeedback(rootSessionID: string, evidence: QualityEvidence): Promise<void> {
    const current = await this.latestRunForSession(rootSessionID)
    if (!current) throw new Error("No completed run is available to rate for this session")
    current.quality = [...current.quality, evidence]
    await this.writeReport(current)
  }
}
