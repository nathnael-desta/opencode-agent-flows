import type { CatalogResult } from "./catalog.js"
import { ORCHESTRATION_ROLES, type OrchestrationConfig, type OrchestrationRole } from "./config.js"
import { rankForRole, roleWeighting } from "./discovery.js"
import { effectiveCost } from "./economics.js"
import { ROLE_TEMPLATES } from "./roles.js"

function priceLabel(blended?: number): string {
  return blended === undefined ? "price n/a" : `$${blended.toFixed(2)}/M blended`
}

function qualityLabel(index?: number): string {
  return index === undefined ? "AA n/a" : `AA ${index.toFixed(1)}`
}

/** Render the discovered catalog as per-role ranked recommendations. */
export function formatDiscovery(result: CatalogResult, opts?: { role?: OrchestrationRole; top?: number }): string {
  const top = opts?.top ?? 5
  const lines: string[] = ["# Model discovery"]
  lines.push(`Quality source: ${result.qualitySource}. Attribution: ${result.attribution}.`)
  if (result.notes.length) lines.push(`Notes: ${result.notes.join("; ")}.`)
  lines.push(`Available models: ${result.catalog.length}.`)

  const roles: OrchestrationRole[] = opts?.role ? [opts.role] : [...ORCHESTRATION_ROLES]
  for (const role of roles) {
    lines.push("", `## ${role} — ranked ${roleWeighting(role)}`)
    const ranked = rankForRole(role, result.catalog).slice(0, top)
    if (!ranked.length) {
      lines.push("- (no candidates available)")
      continue
    }
    for (const candidate of ranked) {
      const context = candidate.context ? `, ${Math.round(candidate.context / 1000)}k ctx` : ""
      const reasoning = candidate.reasoning ? ", reasoning" : ""
      lines.push(`- ${candidate.model} — ${qualityLabel(candidate.quality?.intelligenceIndex)}, ${priceLabel(candidate.blendedPerMillion)}${context}${reasoning}`)
    }
  }

  lines.push(
    "",
    "Prices are paper prices; the setup interview adjusts them to your effective cost by billing source (metered, subscription-flat, credit-pool, bundled-credit). Persist choices with flow_configure.",
  )
  return lines.join("\n")
}

/** Resolve which role a binding is actually inherited from, if any. */
function inheritedFrom(config: OrchestrationConfig, role: OrchestrationRole): OrchestrationRole | undefined {
  if (config.roles[role]) return undefined
  let current: OrchestrationRole | undefined = ROLE_TEMPLATES[role].fallbackFrom
  while (current && !config.roles[current]) current = ROLE_TEMPLATES[current].fallbackFrom
  return current
}

/** Render the saved orchestration configuration for the config view. */
export function formatOrchestrationConfig(
  config: OrchestrationConfig | undefined,
  context: { path: string; active: boolean },
): string {
  if (!config)
    return [
      "# Orchestration configuration",
      "",
      `No configuration is saved at ${context.path}.`,
      "Run the flow-setup command to choose a model for each role, or call flow_configure directly.",
    ].join("\n")

  const lines: string[] = ["# Orchestration configuration"]
  lines.push(config.title ? `${config.title}` : "Custom orchestration")
  lines.push(
    context.active
      ? "Status: active — the plugin is running this configuration."
      : 'Status: saved but NOT active — set { "flow": "custom" } in your opencode.json plugin options and restart OpenCode.',
  )
  lines.push("", "| Role | Model | Billing | Effective | Note |", "|---|---|---|---|---|")
  for (const role of ORCHESTRATION_ROLES) {
    const explicit = config.roles[role]
    const inherited = inheritedFrom(config, role)
    const binding = explicit ?? (inherited ? config.roles[inherited] : undefined)
    if (!binding) continue
    const billing = binding.billingSource ?? "unknown"
    const cost = effectiveCost(undefined, billing)
    const model = `${binding.model}${binding.variant ? ` (${binding.variant})` : ""}${inherited ? ` — inherits ${inherited}` : ""}`
    lines.push(`| ${role} | ${model} | ${billing} | ${cost.perMillion === 0 ? "~$0/M" : "paper price"} | ${binding.effectiveCostNote ?? ""} |`)
  }

  lines.push(
    "",
    `Budgets: ${config.orchestration?.maxTasksPerRun ?? 12} tasks per run, ${config.orchestration?.maxConcurrentWorkers ?? 3} concurrent workers.`,
    `Review: ${config.reviewer?.enabled === false ? "disabled" : "enabled"}, max ${config.reviewer?.maxRounds ?? 2} round(s), max ${config.reviewer?.maxFindings ?? 5} findings.`,
    `Saved at ${context.path}.`,
    "Change one role with flow_configure, or re-run the flow-setup command for the full interview. Restart OpenCode to apply changes.",
  )
  return lines.join("\n")
}
