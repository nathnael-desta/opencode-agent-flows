/**
 * Model quality signal, sourced keyless from Artificial Analysis.
 *
 * Artificial Analysis's documented API requires an account key even on its free
 * tier, which we deliberately avoid. Instead we parse the public models page,
 * which embeds its charts as schema.org `Dataset` blocks in
 * `<script type="application/ld+json">` tags — keyless and marked
 * `isAccessibleForFree`. That page only lists the top ~20 models and its markup
 * can change, so a bundled snapshot backs it up and the whole signal is
 * optional: discovery still works with no quality data at all.
 *
 * Attribution: Artificial Analysis (https://artificialanalysis.ai). Their data
 * is used under their published terms; keep the citation with any display.
 */

export const ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/models"
export const ARTIFICIAL_ANALYSIS_CITATION = "Artificial Analysis Intelligence Index (https://artificialanalysis.ai)"

export interface QualityEntry {
  /** The label as Artificial Analysis presents it, e.g. "GPT-5.6 Sol (max)". */
  label: string
  /** Artificial Analysis Intelligence Index, 0–100 (higher is better). */
  intelligenceIndex: number
}

export interface QualityMatch {
  intelligenceIndex: number
  matchedLabel: string
  source: "artificial-analysis-live" | "artificial-analysis-snapshot"
}

/**
 * Bundled fallback snapshot of the Artificial Analysis Intelligence Index,
 * captured 2026-07-24 from the keyless models page. Refresh periodically; the
 * live parse supersedes it when reachable.
 */
export const QUALITY_SNAPSHOT: QualityEntry[] = [
  { label: "Claude Fable 5", intelligenceIndex: 59.9 },
  { label: "GPT-5.6 Sol (max)", intelligenceIndex: 58.9 },
  { label: "Kimi K3", intelligenceIndex: 57.1 },
  { label: "Claude Opus 4.8 (max)", intelligenceIndex: 55.7 },
  { label: "GPT-5.6 Terra (max)", intelligenceIndex: 55.0 },
  { label: "Grok 4.5 (high)", intelligenceIndex: 53.8 },
  { label: "Claude Sonnet 5 (max)", intelligenceIndex: 53.4 },
  { label: "GPT-5.6 Luna (max)", intelligenceIndex: 51.2 },
  { label: "GLM-5.2 (max)", intelligenceIndex: 51.1 },
  { label: "Muse Spark 1.1 (xhigh)", intelligenceIndex: 50.6 },
  { label: "Gemini 3.6 Flash", intelligenceIndex: 50.1 },
  { label: "Gemini 3.1 Pro Preview", intelligenceIndex: 46.5 },
  { label: "Qwen3.7 Max", intelligenceIndex: 46.0 },
  { label: "MiniMax-M3", intelligenceIndex: 44.4 },
  { label: "DeepSeek V4 Pro (max)", intelligenceIndex: 44.3 },
  { label: "MiMo-V2.5-Pro", intelligenceIndex: 42.2 },
  { label: "Inkling", intelligenceIndex: 40.7 },
  { label: "DeepSeek V4 Flash (max)", intelligenceIndex: 40.3 },
  { label: "Nemotron 3 Ultra", intelligenceIndex: 37.8 },
  { label: "Gemini 3.5 Flash-Lite", intelligenceIndex: 36.5 },
]

/** Reduce a model id or label to a comparison key: alphanumerics only. */
export function qualityKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop reasoning-effort suffixes like "(max)"
    .replace(/with fallback/g, " ")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Extract the Artificial Analysis Intelligence Index from the models page HTML
 * by reading its embedded JSON-LD Dataset blocks. Returns an empty array if the
 * expected structure is absent, so callers fall back to the snapshot.
 */
export function parseArtificialAnalysisHtml(html: string): QualityEntry[] {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  let best: QualityEntry[] = []
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1].trim())
    } catch {
      continue
    }
    // Accept a bare node, an array, or a schema.org { "@graph": [...] } wrapper.
    const nodes = Array.isArray(parsed) ? parsed : [parsed]
    const graphed = nodes.flatMap((node) => {
      const graph = (node as { "@graph"?: unknown })?.["@graph"]
      return Array.isArray(graph) ? graph : [node]
    })
    for (const node of graphed) {
      if (typeof node !== "object" || node === null) continue
      const record = node as Record<string, unknown>
      if (record["@type"] !== "Dataset") continue
      const name = typeof record.name === "string" ? record.name : ""
      if (!/intelligence index/i.test(name)) continue
      if (!Array.isArray(record.data)) continue
      const entries: QualityEntry[] = []
      for (const item of record.data) {
        if (typeof item !== "object" || item === null) continue
        const row = item as Record<string, unknown>
        const label = typeof row.label === "string" ? row.label : undefined
        const index = typeof row.intelligenceIndex === "number" ? row.intelligenceIndex : undefined
        if (label && index !== undefined) entries.push({ label, intelligenceIndex: index })
      }
      // Prefer the exact flagship index chart, but never return an empty set
      // just because its row keys drifted — a larger sibling chart is better.
      if (entries.length && /^artificial analysis intelligence index$/i.test(name)) return entries
      if (entries.length > best.length) best = entries
    }
  }
  return best
}

export interface QualityIndex {
  match(modelId: string, displayName?: string): QualityMatch | undefined
}

/**
 * Build a matcher over quality entries. `live` is true when the entries came
 * from a fresh parse rather than the bundled snapshot.
 */
export function buildQualityIndex(entries: QualityEntry[], live: boolean): QualityIndex {
  const byKey = new Map<string, QualityEntry>()
  for (const entry of entries) {
    const key = qualityKey(entry.label)
    if (key && !byKey.has(key)) byKey.set(key, entry)
  }
  const source = live ? "artificial-analysis-live" : "artificial-analysis-snapshot"
  return {
    match(modelId, displayName) {
      // Exact match only, deliberately.
      //
      // A containment fallback looks helpful but is actively harmful here:
      // every "-mini", "-lite", "-haiku", "-air", "-nano" derivative contains
      // its flagship's key, so it would inherit the flagship's score. A cheap
      // small model credited with a frontier index outranks the real flagship
      // in every role, silently inverting the recommendation this whole system
      // exists to produce. No quality signal is safer than a wrong one, and
      // discovery already renders missing scores as "AA n/a".
      for (const candidate of [modelId, ...(displayName ? [displayName] : [])]) {
        // A model id is provider/model...; compare on the last path segment,
        // since aggregators namespace models (openrouter/anthropic/claude-x).
        const modelPart = candidate.includes("/") ? candidate.slice(candidate.lastIndexOf("/") + 1) : candidate
        const key = qualityKey(modelPart)
        if (!key) continue
        const exact = byKey.get(key)
        if (exact) return { intelligenceIndex: exact.intelligenceIndex, matchedLabel: exact.label, source }
      }
      return undefined
    },
  }
}
