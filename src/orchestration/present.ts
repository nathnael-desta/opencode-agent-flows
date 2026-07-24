import type { CatalogResult } from "./catalog.js"
import { ORCHESTRATION_ROLES, type OrchestrationRole } from "./config.js"
import { rankForRole, roleWeighting } from "./discovery.js"

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
