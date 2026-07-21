import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { renderDashboard } from "./dashboard.js"
import { buildGlobalReport } from "./reports.js"
import { flowReportMarkdown, globalReportMarkdown } from "./markdown.js"
import type { FlowReport, GlobalReport, QualityEvidence } from "./types.js"

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

export class TelemetryStore {
  constructor(
    readonly directory: string,
    readonly options: { dashboard?: boolean; retentionDays?: number } = {},
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
        report: await readJson<FlowReport>(join(directory, file)),
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
      writes.push(atomicWrite(join(this.directory, "dashboard.html"), renderDashboard(global, runs)))
    }
    await Promise.all(writes)
    return global
  }

  async latestRun(): Promise<FlowReport | undefined> {
    return readJson<FlowReport>(join(this.directory, "latest-run.json"))
  }

  async latestRunForSession(rootSessionID: string): Promise<FlowReport | undefined> {
    const reports = await this.listRuns()
    return reports.filter((report) => report.rootSessionID === rootSessionID).at(-1)
  }

  async latestSession(): Promise<FlowReport | undefined> {
    return readJson<FlowReport>(join(this.directory, "latest-session.json"))
  }

  async session(rootSessionID: string): Promise<FlowReport | undefined> {
    return readJson<FlowReport>(join(this.directory, "sessions", `${safeName(rootSessionID)}.json`))
  }

  async global(): Promise<GlobalReport> {
    return (await readJson<GlobalReport>(join(this.directory, "global.json"))) ?? buildGlobalReport([])
  }

  async appendFeedback(rootSessionID: string, evidence: QualityEvidence): Promise<void> {
    const current = await this.latestRunForSession(rootSessionID)
    if (!current) throw new Error("No completed run is available to rate for this session")
    current.quality = [...current.quality, evidence]
    await this.writeReport(current)
  }
}
