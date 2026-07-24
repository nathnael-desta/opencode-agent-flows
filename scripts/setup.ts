#!/usr/bin/env bun
/**
 * Terminal setup for the orchestration configuration.
 *
 * The in-OpenCode `flow-setup` command is the primary experience because it can
 * see exactly which providers OpenCode has authenticated. This CLI covers the
 * terminal case: point it at a running OpenCode server for the real list, or
 * let it fall back to your opencode.json providers plus the models.dev catalog.
 *
 * All decision logic lives in src/orchestration/setup.ts so the interactive and
 * non-interactive paths share one validated route to the saved file.
 */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { discoverCatalog, indexModelsDev } from "../src/orchestration/catalog.js"
import { fetchWithTimeout } from "../src/orchestration/cache.js"
import { BILLING_SOURCES, saveOrchestrationConfig, type BillingSource, type OrchestrationRole } from "../src/orchestration/config.js"
import { normalizeProviders, rankForRole, type DiscoveredProvider } from "../src/orchestration/discovery.js"
import { formatOrchestrationConfig } from "../src/orchestration/present.js"
import {
  buildOrchestrationConfig,
  CONFIGURABLE_ROLES,
  isModelReference,
  normalizeBillingAnswer,
  providersNeedingBilling,
  resolveSelection,
  ROLE_HELP,
} from "../src/orchestration/setup.js"
import { defaultTelemetryDirectory, expandPath } from "../src/telemetry/path.js"

const USAGE = `Orchestration setup

  bun run setup [options]

Options:
  --server <url>            Read the live provider list from a running OpenCode server
  --state-dir <path>        Where to write orchestration-config.json
  --title <name>            Name the configuration
  --orchestrator <model>    Set a role non-interactively (also --bulk, --routine,
  --routine <model>         --reviewer, --deep). provider/model form.
  --billing <p>=<source>    Billing source for a provider, repeatable.
                            One of: ${BILLING_SOURCES.join(", ")}
  --note <p>=<text>         Effective-cost note for a provider, repeatable.
  --yes                     Save without confirming (non-interactive)
  --help                    Show this message

Non-interactive example:
  bun run setup --orchestrator openai/gpt-5.6-sol --routine commandcode/deepseek-v4-pro \\
    --billing openai=subscription-flat --note openai="ChatGPT Plus" --yes
`

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function argValues(flag: string): string[] {
  const values: string[] = []
  process.argv.forEach((entry, index) => {
    if (entry === flag && process.argv[index + 1]) values.push(process.argv[index + 1])
  })
  return values
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

/** Parse repeatable `key=value` flags. */
function keyValues(flag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of argValues(flag)) {
    const at = entry.indexOf("=")
    if (at <= 0) continue
    result[entry.slice(0, at)] = entry.slice(at + 1)
  }
  return result
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

async function resolveProviders(): Promise<{ providers: DiscoveredProvider[]; source: string; trusted: boolean }> {
  const server = argValue("--server") ?? process.env.OPENCODE_SERVER
  if (server) {
    try {
      const providers = await providersFromServer(server)
      if (providers.length) return { providers, source: `OpenCode server at ${server}`, trusted: true }
    } catch (error) {
      console.warn(`Could not reach the OpenCode server (${error instanceof Error ? error.message : String(error)}); falling back.`)
    }
  }
  const configured = await providersFromOpenCodeConfig()
  const providers = await providersFromModelsDev(configured)
  return configured.length
    ? { providers, source: `models.dev, limited to your opencode.json providers (${configured.join(", ")})`, trusted: true }
    : { providers, source: "models.dev (full catalog)", trusted: false }
}

/** Collected non-interactive role flags, if any were supplied. */
function roleFlags(): Partial<Record<OrchestrationRole, string>> {
  const selections: Partial<Record<OrchestrationRole, string>> = {}
  for (const role of CONFIGURABLE_ROLES) {
    const value = argValue(`--${role}`)
    if (value) selections[role] = value
  }
  return selections
}

class InputClosed extends Error {}

async function main(): Promise<void> {
  if (hasFlag("--help")) {
    console.log(USAGE)
    return
  }

  const reportDirectory = expandPath(argValue("--state-dir") ?? defaultTelemetryDirectory())
  const configPath = join(reportDirectory, "orchestration-config.json")
  const billingFlags = keyValues("--billing")
  const noteFlags = keyValues("--note")
  const title = argValue("--title")
  const preselected = roleFlags()
  const nonInteractive = Object.keys(preselected).length > 0 || hasFlag("--yes")

  // Non-interactive: everything needed came from flags, so never touch stdin.
  if (nonInteractive) {
    const billing: Record<string, BillingSource> = {}
    for (const [provider, value] of Object.entries(billingFlags)) {
      const source = normalizeBillingAnswer(value)
      if (!source) {
        console.error(`Unknown billing source "${value}" for ${provider}. One of: ${BILLING_SOURCES.join(", ")}`)
        process.exitCode = 1
        return
      }
      billing[provider] = source
    }
    for (const [role, model] of Object.entries(preselected)) {
      if (!isModelReference(model)) {
        console.error(`--${role} "${model}" is not a provider/model value.`)
        process.exitCode = 1
        return
      }
    }
    let config
    try {
      config = buildOrchestrationConfig({ selections: preselected, billing, notes: noteFlags, title })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
      return
    }
    await saveOrchestrationConfig(configPath, config)
    console.log(formatOrchestrationConfig(config, { path: configPath, active: false }))
    console.log(`\nSaved ${configPath}`)
    console.log('Set { "flow": "custom" } in your opencode.json plugin options, then restart OpenCode.')
    return
  }

  if (!process.stdin.isTTY) {
    console.error("This setup is interactive. Run it from a terminal, pass role flags for a")
    console.error("non-interactive run (see --help), or use the flow-setup command inside OpenCode.")
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
    const { providers, source, trusted } = await resolveProviders()
    console.log(`Model source: ${source}`)
    if (!providers.length) {
      console.log("No providers were discovered. Configure a provider in opencode.json, pass --server <url>,")
      console.log("or use the flow-setup command inside OpenCode, which reads your live provider list.")
      process.exitCode = 1
      return
    }
    if (!trusted) {
      console.log("Warning: no OpenCode server and no providers in opencode.json, so this lists the")
      console.log("entire models.dev catalog, including providers you cannot actually reach.")
      console.log("For your real list, run flow-setup inside OpenCode or pass --server <url>.")
    }

    const result = await discoverCatalog({ providers, cacheDir: join(reportDirectory, "cache") })
    console.log(`Quality source: ${result.qualitySource} (${result.attribution})`)
    for (const note of result.notes) console.log(`Note: ${note}`)
    console.log(`Discovered ${result.catalog.length} models.\n`)
    console.log("Effective cost matters more than paper price. You will be asked how each provider")
    console.log("you pick is billed, so a subscription or prepaid bundle can make an expensive-looking")
    console.log("model the right cheap default.\n")

    const selections: Partial<Record<OrchestrationRole, string>> = {}
    for (const role of CONFIGURABLE_ROLES) {
      const ranked = rankForRole(role, result.catalog).slice(0, 8)
      console.log(`\n== ${role} ==\n${ROLE_HELP[role]}`)
      if (!ranked.length) {
        console.log("  (no tool-capable candidates found)")
        continue
      }
      ranked.forEach((candidate, index) => {
        const quality = candidate.quality ? `AA coding ${candidate.quality.score.toFixed(1)}` : "quality n/a"
        const price = candidate.blendedPerMillion === undefined ? "price n/a" : `$${candidate.blendedPerMillion.toFixed(2)}/M`
        console.log(`  ${index + 1}. ${candidate.model} — ${quality}, ${price}`)
      })
      // Re-ask on invalid input instead of silently dropping the role.
      for (;;) {
        const answer = await ask(`Choose 1-${ranked.length}, a provider/model, or Enter to inherit: `)
        const outcome = resolveSelection(answer, ranked)
        if (outcome.error) {
          console.log(`  ${outcome.error}`)
          continue
        }
        if (outcome.model) selections[role] = outcome.model
        break
      }
    }

    if (!selections.orchestrator || !selections.routine) {
      console.log("\norchestrator and routine are required. Nothing was saved.")
      process.exitCode = 1
      return
    }

    const billing: Record<string, BillingSource> = {}
    const notes: Record<string, string> = {}
    for (const provider of providersNeedingBilling(selections)) {
      console.log(`\nHow is "${provider}" billed for you?`)
      BILLING_SOURCES.forEach((option, index) => console.log(`  ${index + 1}. ${option}`))
      for (;;) {
        const answer = await ask("Choose 1-5 (Enter for metered): ")
        const selected = normalizeBillingAnswer(answer)
        if (!selected) {
          console.log(`  Choose 1-${BILLING_SOURCES.length}, or one of: ${BILLING_SOURCES.join(", ")}`)
          continue
        }
        billing[provider] = selected
        if (selected !== "metered" && selected !== "unknown") {
          const note = (await ask("Short note on why (for example 'Antigravity credits'), or Enter to skip: ")).trim()
          if (note) notes[provider] = note
        }
        break
      }
    }

    const chosenTitle = title ?? (await ask("\nName this configuration (Enter for default): ")).trim()
    const config = buildOrchestrationConfig({ selections, billing, notes, title: chosenTitle || undefined })

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
