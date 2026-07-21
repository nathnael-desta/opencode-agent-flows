import type { FlowReport, GlobalReport, QuotaSnapshot } from "./types.js"

function quotaLine(quota: QuotaSnapshot): string {
  if (quota.status !== "available") return `${quota.source}: ${quota.status}`
  if (quota.primary) return `${quota.source}: primary ${quota.primary.usedPercent}%${quota.secondary ? `, secondary ${quota.secondary.usedPercent}%` : ""}`
  if (quota.allowanceUsd !== undefined) return `${quota.source}: $${(quota.spentUsd ?? 0).toFixed(2)} / $${quota.allowanceUsd.toFixed(2)}`
  return `${quota.source}: available`
}

function duration(ms?: number): string {
  if (ms === undefined) return "Unavailable"
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`
}

function apiCost(cost: number, unpriced: number): string {
  return unpriced > 0 ? `${cost > 0 ? `$${cost.toFixed(4)} + ` : ""}${unpriced} unpriced call${unpriced === 1 ? "" : "s"}` : `$${cost.toFixed(4)}`
}

export function flowReportMarkdown(report: FlowReport): string {
  const title = report.scope === "run" ? "Run Report" : "Session Report"
  const modelRows = report.byModel.length === 0 ? ["No model calls recorded."] : [
    "| Model | Calls | Input | Output | Metered | API-equivalent |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.byModel.map((model) => `| ${model.providerID}/${model.modelID} | ${model.calls} | ${model.tokens.input.toLocaleString()} | ${(model.tokens.output + model.tokens.reasoning).toLocaleString()} | $${model.costUsd.toFixed(4)} | ${apiCost(model.apiEquivalentCostUsd, model.apiEquivalentUnpricedCalls)} |`),
  ]
  const agentRows = report.byAgent.length === 0 ? ["No agent calls recorded."] : [
    "| Agent | Role | Model | Billing | Calls | Metered | API-equivalent |",
    "|---|---|---|---|---:|---:|---:|",
    ...report.byAgent.map((agent) => `| ${agent.agent} | ${agent.role} | ${agent.modelID} | ${agent.billingSource} | ${agent.calls} | $${agent.costUsd.toFixed(4)} | ${apiCost(agent.apiEquivalentCostUsd, agent.apiEquivalentUnpricedCalls)} |`),
  ]
  const workReportRows = report.tasks.filter((task) => task.workReport || task.workReportError).length === 0 ? ["No structured worker reports recorded."] : [
    "| Agent | Status | Files | Verification | Note |",
    "|---|---|---:|---:|---|",
    ...report.tasks.filter((task) => task.workReport || task.workReportError).map((task) => `| ${task.agent ?? "unknown"} | ${task.workReport?.status ?? "incomplete"} | ${task.workReport?.filesChanged.length ?? 0} | ${task.workReport?.verification.length ?? 0} | ${task.workReportError ?? task.workReport?.blocker ?? ""} |`),
  ]
  return [
    `# ${title}: ${report.flowTitle}`,
    `**Scope:** ${report.scope}  `,
    `**Run:** ${report.runID ?? "all runs"}  `,
    `**Session:** ${report.rootSessionID}`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Subagents spawned | ${report.totals.subagentsSpawned} |`,
    `| Tasks completed / started | ${report.totals.tasksCompleted} / ${report.totals.tasksStarted} |`,
    `| Verification failures | ${report.totals.verificationFailures} |`,
    `| Model calls | ${report.totals.calls} |`,
    `| Time used | ${duration(report.durationMs)} |`,
    `| Metered cost | $${report.totals.costUsd.toFixed(4)} |`,
    `| API-equivalent cost | ${apiCost(report.totals.apiEquivalentCostUsd, report.totals.apiEquivalentUnpricedCalls)} |`,
    "",
    "## Models",
    ...modelRows,
    "",
    "## Agents",
    ...agentRows,
    "",
    "## Worker Reports",
    ...workReportRows,
    "",
    "## Quotas",
    ...(report.quotas.length > 0 ? report.quotas.map(quotaLine) : ["Unavailable"]),
    "",
    "## Interpretation",
    report.estimate.assumption,
    "",
  ].join("\n")
}

export function globalReportMarkdown(report: GlobalReport): string {
  return [
    "# Agent Flow Global Report",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Runs | ${report.runs} |`,
    `| Subagents | ${report.totals.subagentsSpawned} |`,
    `| Average time used | ${duration(report.averageDurationMs)} |`,
    `| Metered cost | $${report.totals.costUsd.toFixed(4)} |`,
    `| API-equivalent cost | ${apiCost(report.totals.apiEquivalentCostUsd, report.totals.apiEquivalentUnpricedCalls)} |`,
    `| Average estimated reduction | ${report.averageEstimatedUsageReductionPct}% |`,
    `| Good / mixed / bad feedback | ${report.feedback.good ?? 0} / ${report.feedback.mixed ?? 0} / ${report.feedback.bad ?? 0} |`,
    "",
  ].join("\n")
}
