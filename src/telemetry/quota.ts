import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { FlowReport, QuotaSnapshot, QuotaWindow } from "./types.js"

interface CodexWindow {
  usedPercent?: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

interface CodexRateLimits {
  planType?: string | null
  primary?: CodexWindow | null
  secondary?: CodexWindow | null
}

function normalizeWindow(window?: CodexWindow | null): QuotaWindow | undefined {
  if (!window || typeof window.usedPercent !== "number") return undefined
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins ?? undefined,
    resetsAt: window.resetsAt ?? undefined,
  }
}

export async function readCodexQuota(timeoutMs = 5_000): Promise<QuotaSnapshot> {
  const capturedAt = Date.now()
  return new Promise((resolve) => {
    const child = spawn("codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env,
    })
    let settled = false
    const finish = (snapshot: QuotaSnapshot) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(snapshot)
    }
    const timer = setTimeout(() => finish({
      source: "codex",
      status: "error",
      capturedAt,
      error: `Timed out after ${timeoutMs}ms`,
    }), timeoutMs)
    const lines = createInterface({ input: child.stdout })

    lines.on("line", (line) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        return
      }
      if (message.id === 1 && message.result) {
        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
        child.stdin.write(`${JSON.stringify({ id: 2, method: "account/rateLimits/read", params: null })}\n`)
        return
      }
      if (message.id !== 2) return
      if (message.error) {
        finish({ source: "codex", status: "error", capturedAt, error: message.error.message ?? "Unknown Codex error" })
        return
      }
      const result = message.result as { rateLimits?: CodexRateLimits } | undefined
      const limits = result?.rateLimits
      finish({
        source: "codex",
        status: limits ? "available" : "unavailable",
        capturedAt,
        planType: limits?.planType ?? undefined,
        primary: normalizeWindow(limits?.primary),
        secondary: normalizeWindow(limits?.secondary),
      })
    })
    child.on("error", (error) => finish({ source: "codex", status: "error", capturedAt, error: error.message }))
    child.on("exit", (code) => {
      if (!settled) finish({ source: "codex", status: "error", capturedAt, error: `Codex exited with code ${code}` })
    })
    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "opencode-agent-flows", version: "0.1.0" }, capabilities: null },
    })}\n`)
  })
}

export function commandCodeBudget(reports: FlowReport[], allowanceUsd?: number): QuotaSnapshot {
  const spentUsd = reports.reduce(
    (sum, report) => sum + report.byModel
      .filter((model) => model.providerID === "commandcode")
      .reduce((modelSum, model) => modelSum + model.costUsd, 0),
    0,
  )
  return {
    source: "commandcode-local-budget",
    status: allowanceUsd === undefined ? "unavailable" : "available",
    capturedAt: Date.now(),
    spentUsd: Number(spentUsd.toFixed(6)),
    allowanceUsd,
  }
}
