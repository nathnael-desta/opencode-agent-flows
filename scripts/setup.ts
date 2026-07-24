#!/usr/bin/env bun
/**
 * Terminal setup for the orchestration configuration.
 *
 * The in-OpenCode `flow-setup` command is the primary experience because it can
 * see exactly which providers OpenCode has authenticated. This CLI covers the
 * terminal case: point it at a running OpenCode server for the real list, or
 * let it fall back to your opencode.json providers plus the models.dev catalog.
 */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { discoverCatalog, indexModelsDev } from "../src/orchestration/catalog.js"
import { fetchWithTimeout } from "../src/orchestration/cache.js"
import {
  BILLING_SOURCES,
  ORCHESTRATION_CONFIG_VERSION,
  normalizeOrchestrationConfig,
  saveOrchestrationConfig,
  type BillingSource,
  type OrchestrationRole,
  type RoleBinding,
} from "../src/orchestration/config.js"
import { normalizeProviders, rankForRole, type DiscoveredProvider } from "../src/orchestration/discovery.js"
import { formatOrchestrationConfig } from "../src/orchestration/present.js"
import { defaultTelemetryDirectory, expandPath } from "../src/telemetry/path.js"

const CONFIGURABLE_ROLES: OrchestrationRole[] = ["orchestrator", "bulk", "routine", "reviewer", "deep"]

const ROLE_HELP: Record<string, string> = {
  orchestrator: "Routes and delegates every turn. Wants strong reasoning at low effective cost.",
  bulk: "Repetitive, low-risk, token-heavy work. Wants the cheapest capable model.",
  routine: "The default worker for bounded implementation. Wants balance.",
  reviewer: "Independent milestone review. Prefer a different model family from routine.",
  deep: "Evidence-backed escalation after routine fails. Wants the strongest model.",
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** Strip // and /* *\/ comments so opencode.jsonc parses as JSON. */
function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1")
}

async function providersFromServer(url: string): Promise<DiscoveredProvider[]> {
  const response = await fetchWithTimeout(`${url.replace(/\/$/, "")}/config/providers`, 5000)
  return normalizeProviders(JSON.parse(response))
}

async function providersFromOpenCodeConfig(): Promise<string[]> {
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    try {
      const parsed = JSON.parse(stripJsonComments(await readFile(join(homedir(), ".config", "opencode", name), "utf8")))
      const ids = Object.keys(parsed?.provider ?? {})
      if (ids.length) return ids
    } catch {
      // Try the next candidate.
    }
  }
  return []
}

async function providersFromModelsDev(filter: string[]): Promise<DiscoveredProvider[]> {
  let index: ReturnType<typeof indexModelsDev>
  try {
    index = indexModelsDev(JSON.parse(await fetchWithTimeout("https://models.dev/api.json", 15000)))
  } catch (error) {
    console.warn(`Could not reach models.dev (${error instanceof Error ? error.message : String(error)}).`)
    return []
  }
  return Object.entries(index)
    .filter(([id]) => filter.length === 0 || filter.includes(id))
    .map(([id, models]) => ({
      id,
      models: Object.entries(models).map(([modelId, model]) => ({
        id: modelId,
        name: model.name,
        cost: model.cost,
        limit: model.limit,
        reasoning: model.reasoning,
        toolCall: model.tool_call,
      })),
    }))
}

async function resolveProviders(): Promise<{ providers: DiscoveredProvider[]; source: string }> {
  const server = argValue("--server") ?? process.env.OPENCODE_SERVER
  if (server) {
    try {
      const providers = await providersFromServer(server)
      if (providers.length) return { providers, source: `OpenCode server at ${server}` }
    } catch (error) {
      console.warn(`Could not reach the OpenCode server (${error instanceof Error ? error.message : String(error)}); falling back.`)
    }
  }
  const configured = await providersFromOpenCodeConfig()
  const providers = await providersFromModelsDev(configured)
  return {
    providers,
    source: configured.length ? `models.dev, limited to your opencode.json providers (${configured.join(", ")})` : "models.dev (full catalog)",
  }
}

/** Raised when stdin ends, so the CLI can exit cleanly instead of crashing. */
class InputClosed extends Error {}

async function main(): Promise<void> {
  const reportDirectory = expandPath(argValue("--state-dir") ?? defaultTelemetryDirectory())
  const configPath = join(reportDirectory, "orchestration-config.json")
  if (!process.stdin.isTTY) {
    console.error("This setup is interactive; run it from a terminal, or use the flow-setup command inside OpenCode.")
    process.exitCode = 1
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = async (question: string): Promise<string> => {
    try {
      return await rl.question(question)
    } catch {
      throw new InputClosed()
    }
  }

  try {
    console.log("Orchestration setup\n")
    const { providers, source } = await resolveProviders()
    console.log(`Model source: ${source}`)
    if (!providers.length) {
      console.log("No providers were discovered. Configure a provider in opencode.json, pass --server <url>,")
      console.log("or use the flow-setup command inside OpenCode, which reads your live provider list.")
      process.exitCode = 1
      return
    }

    if (source.startsWith("models.dev (full")) {
      console.log("Warning: no OpenCode server and no providers in opencode.json, so this lists")
      console.log("the entire models.dev catalog, including providers you cannot actually reach.")
      console.log("For the accurate list, run the flow-setup command inside OpenCode, or pass --server <url>.")
    }

    const result = await discoverCatalog({ providers, cacheDir: join(reportDirectory, "cache") })
    console.log(`Quality source: ${result.qualitySource} (${result.attribution})`)
    for (const note of result.notes) console.log(`Note: ${note}`)
    console.log(`Discovered ${result.catalog.length} models.\n`)

    console.log("Effective cost matters more than paper price. You will be asked how each")
    console.log("provider you pick is billed, so a subscription or prepaid bundle can make an")
    console.log("expensive-looking model the right cheap default.\n")

    const chosen: Partial<Record<OrchestrationRole, RoleBinding>> = {}
    for (const role of CONFIGURABLE_ROLES) {
      const ranked = rankForRole(role, result.catalog).slice(0, 8)
      console.log(`\n== ${role} ==\n${ROLE_HELP[role]}`)
      ranked.forEach((candidate, index) => {
        const quality = candidate.quality ? `AA ${candidate.quality.intelligenceIndex.toFixed(1)}` : "AA n/a"
        const price = candidate.blendedPerMillion === undefined ? "price n/a" : `$${candidate.blendedPerMillion.toFixed(2)}/M`
        console.log(`  ${index + 1}. ${candidate.model} — ${quality}, ${price}`)
      })
      const answer = (await ask(`Choose 1-${ranked.length}, type a provider/model, or press Enter to inherit: `)).trim()
      if (!answer) continue
      const numeric = Number(answer)
      const model = Number.isInteger(numeric) && numeric >= 1 && numeric <= ranked.length ? ranked[numeric - 1].model : answer
      if (!/^[^/\s]+\/\S+$/.test(model)) {
        console.log(`  Skipping ${role}: "${answer}" is not a provider/model value.`)
        continue
      }
      chosen[role] = { model }
    }

    if (!chosen.orchestrator || !chosen.routine) {
      console.log("\norchestrator and routine are required. Nothing was saved.")
      return
    }

    // Ask billing once per distinct provider rather than once per role.
    const billing = new Map<string, BillingSource>()
    const notes = new Map<string, string>()
    for (const binding of Object.values(chosen)) {
      const provider = binding.model.split("/")[0]
      if (billing.has(provider)) continue
      console.log(`\nHow is "${provider}" billed for you?`)
      BILLING_SOURCES.forEach((option, index) => console.log(`  ${index + 1}. ${option}`))
      const answer = (await ask("Choose 1-5 (default metered): ")).trim()
      const numeric = Number(answer)
      const selected = Number.isInteger(numeric) && numeric >= 1 && numeric <= BILLING_SOURCES.length ? BILLING_SOURCES[numeric - 1] : "metered"
      billing.set(provider, selected)
      if (selected === "subscription-flat" || selected === "bundled-credit" || selected === "credit-pool") {
        const note = (await ask("Short note on why (for example 'Antigravity credits'), or Enter to skip: ")).trim()
        if (note) notes.set(provider, note)
      }
    }

    const rolesRecord: Record<string, RoleBinding> = {}
    for (const [role, binding] of Object.entries(chosen)) {
      const provider = binding.model.split("/")[0]
      const note = notes.get(provider)
      rolesRecord[role] = {
        ...binding,
        billingSource: billing.get(provider) ?? "metered",
        ...(note ? { effectiveCostNote: note } : {}),
      }
    }

    const title = (await ask("\nName this configuration (Enter for default): ")).trim()
    const config = normalizeOrchestrationConfig({
      version: ORCHESTRATION_CONFIG_VERSION,
      ...(title ? { title } : {}),
      roles: rolesRecord,
    })

    console.log(`\n${formatOrchestrationConfig(config, { path: configPath, active: false })}\n`)
    const confirm = (await ask("Save this configuration? [y/N] ")).trim().toLowerCase()
    if (confirm !== "y" && confirm !== "yes") {
      console.log("Nothing was saved.")
      return
    }

    await saveOrchestrationConfig(configPath, config)
    console.log(`\nSaved ${configPath}`)
    console.log('Set { "flow": "custom" } in your opencode.json plugin options, then restart OpenCode.')
  } catch (error) {
    if (!(error instanceof InputClosed)) throw error
    console.log("\nInput ended before setup finished; nothing was saved.")
    process.exitCode = 1
  } finally {
    rl.close()
  }
}

await main()
