import { join } from "node:path"
import { fetchWithTimeout, readCache, readStaleCache, writeCache } from "./cache.js"
import { buildCatalog, type DiscoveredProvider, type ModelCandidate, type ModelsDevIndex } from "./discovery.js"
import {
  ARTIFICIAL_ANALYSIS_CITATION,
  ARTIFICIAL_ANALYSIS_URL,
  buildQualityIndex,
  parseArtificialAnalysisHtml,
  QUALITY_SNAPSHOT,
  type QualityEntry,
} from "./quality.js"

const MODELS_DEV_URL = "https://models.dev/api.json"
const DAY_MS = 24 * 60 * 60 * 1000

interface QualityCache {
  live: boolean
  entries: QualityEntry[]
}

/** Reduce the raw models.dev api.json into `provider -> model -> fields`. */
export function indexModelsDev(raw: unknown): ModelsDevIndex {
  const index: ModelsDevIndex = {}
  if (typeof raw !== "object" || raw === null) return index
  for (const [providerId, providerValue] of Object.entries(raw as Record<string, unknown>)) {
    const models = (providerValue as { models?: unknown })?.models
    if (typeof models !== "object" || models === null) continue
    const perModel: ModelsDevIndex[string] = {}
    for (const [modelId, modelValue] of Object.entries(models as Record<string, unknown>)) {
      if (typeof modelValue !== "object" || modelValue === null) continue
      const m = modelValue as Record<string, unknown>
      perModel[modelId] = {
        name: typeof m.name === "string" ? m.name : undefined,
        cost: m.cost as { input?: number; output?: number } | undefined,
        limit: m.limit as { context?: number } | undefined,
        reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
        tool_call: typeof m.tool_call === "boolean" ? m.tool_call : undefined,
      }
    }
    index[providerId] = perModel
  }
  return index
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface CatalogResult {
  catalog: ModelCandidate[]
  qualitySource: string
  attribution: string
  notes: string[]
}

/**
 * Discover the model catalog: available provider models, enriched with
 * models.dev pricing and an Artificial Analysis quality index. Every network
 * source degrades to cache, then to a bundled snapshot or provider data, so the
 * result is always usable. `fetchText` is injectable for tests.
 */
export async function discoverCatalog(opts: {
  providers: DiscoveredProvider[]
  cacheDir: string
  refresh?: boolean
  fetchText?: (url: string) => Promise<string>
}): Promise<CatalogResult> {
  const fetchText = opts.fetchText ?? ((url: string) => fetchWithTimeout(url))
  const notes: string[] = []

  const modelsDevCache = join(opts.cacheDir, "models-dev.json")
  let modelsDev = opts.refresh ? undefined : await readCache<ModelsDevIndex>(modelsDevCache, DAY_MS)
  if (!modelsDev) {
    try {
      modelsDev = indexModelsDev(JSON.parse(await fetchText(MODELS_DEV_URL)))
      await writeCache(modelsDevCache, modelsDev)
    } catch (error) {
      modelsDev = await readStaleCache<ModelsDevIndex>(modelsDevCache)
      notes.push(`models.dev unavailable (${message(error)}); ${modelsDev ? "using cached pricing" : "using provider-supplied pricing only"}`)
    }
  }

  const qualityCache = join(opts.cacheDir, "artificial-analysis.json")
  let quality = opts.refresh ? undefined : await readCache<QualityCache>(qualityCache, DAY_MS)
  if (!quality) {
    try {
      const parsed = parseArtificialAnalysisHtml(await fetchText(ARTIFICIAL_ANALYSIS_URL))
      if (parsed.length) {
        quality = { live: true, entries: parsed }
        await writeCache(qualityCache, quality)
      } else {
        notes.push("Artificial Analysis page had no parsable index; using bundled quality snapshot")
        quality = { live: false, entries: QUALITY_SNAPSHOT }
      }
    } catch (error) {
      const stale = await readStaleCache<QualityCache>(qualityCache)
      if (stale?.entries?.length) {
        quality = stale
        notes.push(`Artificial Analysis unavailable (${message(error)}); using cached quality data`)
      } else {
        quality = { live: false, entries: QUALITY_SNAPSHOT }
        notes.push(`Artificial Analysis unavailable (${message(error)}); using bundled quality snapshot`)
      }
    }
  }

  const qualityIndex = buildQualityIndex(quality.entries, quality.live)
  const catalog = buildCatalog({ providers: opts.providers, modelsDev, quality: qualityIndex })
  if (!catalog.length) notes.push("No provider models were discovered; check that OpenCode has configured, authenticated providers.")

  return {
    catalog,
    qualitySource: quality.live ? "Artificial Analysis (live)" : "Artificial Analysis (bundled snapshot)",
    attribution: ARTIFICIAL_ANALYSIS_CITATION,
    notes,
  }
}
