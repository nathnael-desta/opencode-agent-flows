/**
 * Model quality signal: Artificial Analysis indices, fetched keyless as JSON.
 *
 * Artificial Analysis's own API requires an account key even on its free tier,
 * which we will not ask users for. OpenRouter republishes AA's indices in its
 * public, keyless models endpoint, which is strictly better than scraping AA's
 * HTML: it is real JSON rather than markup, it covers ~116 models instead of
 * the ~20 the public chart renders, and it carries a coding-specific index that
 * the chart does not expose at all.
 *
 * Attribution: the numbers originate with Artificial Analysis
 * (https://artificialanalysis.ai), consumed via OpenRouter.
 */

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
export const QUALITY_ATTRIBUTION = "Artificial Analysis (https://artificialanalysis.ai), via OpenRouter"

/** Which index a score came from. Scales are not interchangeable. */
export type QualityScale = "aa-coding-index" | "aa-intelligence-index"

export interface QualityEntry {
  /** OpenRouter model id, for example "google/gemini-3.6-flash". */
  id: string
  intelligence?: number
  coding?: number
  agentic?: number
}

export interface QualityMatch {
  /** The value used for ranking, on `scale`. */
  score: number
  scale: QualityScale
  intelligence?: number
  coding?: number
  agentic?: number
  matchedId: string
  source: "openrouter-live" | "openrouter-snapshot"
}

/**
 * Bundled offline fallback, captured 2026-07-24 from the keyless endpoint.
 * Sorted by coding index. Refresh periodically; a live fetch supersedes it.
 */
export const QUALITY_SNAPSHOT: QualityEntry[] = [
  { id: "openai/gpt-5.6-sol", intelligence: 58.9, coding: 77.4, agentic: 54 },
  { id: "openai/gpt-5.6-terra", intelligence: 55, coding: 76.7, agentic: 47.4 },
  { id: "anthropic/claude-fable-5", intelligence: 59.9, coding: 76.5, agentic: 52.8 },
  { id: "moonshotai/kimi-k3", intelligence: 57.1, coding: 76.2, agentic: 50.1 },
  { id: "openai/gpt-5.5", intelligence: 54.8, coding: 74.9, agentic: 44.9 },
  { id: "anthropic/claude-opus-4.8", intelligence: 55.7, coding: 74.3, agentic: 47.2 },
  { id: "anthropic/claude-opus-4.7", intelligence: 53.5, coding: 73.6, agentic: 44.4 },
  { id: "x-ai/grok-4.5", intelligence: 53.8, coding: 72.4, agentic: 45.7 },
  { id: "anthropic/claude-sonnet-5", intelligence: 53.4, coding: 71.5, agentic: 46.7 },
  { id: "openai/gpt-5.6-luna", intelligence: 51.2, coding: 71.4, agentic: 45.6 },
  { id: "meta/muse-spark-1.1", intelligence: 50.6, coding: 71.3, agentic: 37.5 },
  { id: "openai/gpt-5.4", intelligence: 51.4, coding: 71.1, agentic: 41.1 },
  { id: "google/gemini-3.5-flash", intelligence: 50.2, coding: 70.1, agentic: 37.4 },
  { id: "google/gemini-3.6-flash", intelligence: 50.1, coding: 69.2, agentic: 38.7 },
  { id: "z-ai/glm-5.2", intelligence: 51.1, coding: 68.8, agentic: 43.1 },
  { id: "google/gemini-3.1-pro-preview", intelligence: 46.5, coding: 68.8, agentic: 21.4 },
  { id: "qwen/qwen3.7-max", intelligence: 46, coding: 66, agentic: 30.6 },
  { id: "anthropic/claude-sonnet-4.6", intelligence: 47.2, coding: 63, agentic: 40.8 },
  { id: "moonshotai/kimi-k2.6", intelligence: 44.2, coding: 61.8, agentic: 30.3 },
  { id: "moonshotai/kimi-k2.7-code", intelligence: 41.9, coding: 60.8, agentic: 29.6 },
  { id: "xiaomi/mimo-v2.5-pro", intelligence: 42.2, coding: 60.2, agentic: 29.1 },
  { id: "kwaipilot/kat-coder-pro-v2", intelligence: 33.7, coding: 59.5, agentic: 15.5 },
  { id: "deepseek/deepseek-v4-pro", intelligence: 44.3, coding: 59.4, agentic: 36.4 },
  { id: "nex-agi/nex-n2-pro", intelligence: 41, coding: 59.1, agentic: 31 },
  { id: "tencent/hy3-preview", intelligence: 41.2, coding: 58.8, agentic: 30.7 },
  { id: "minimax/minimax-m3", intelligence: 44.4, coding: 58.6, agentic: 35.4 },
  { id: "xiaomi/mimo-v2.5", intelligence: 37.2, coding: 56.8, agentic: 23.7 },
  { id: "deepseek/deepseek-v4-flash", intelligence: 40.3, coding: 56.2, agentic: 31.1 },
  { id: "openai/gpt-5.4-nano", intelligence: 38.2, coding: 56.1, agentic: 27.5 },
  { id: "openai/gpt-5.4-mini", intelligence: 40, coding: 56.1, agentic: 30.2 },
  { id: "qwen/qwen3.7-plus", intelligence: 39, coding: 55.9, agentic: 20.8 },
  { id: "z-ai/glm-5.1", intelligence: 40.2, coding: 55.8, agentic: 29.9 },
  { id: "qwen/qwen3.6-plus", intelligence: 39.6, coding: 54.5, agentic: 27.6 },
  { id: "qwen/qwen3.6-27b", intelligence: 37.1, coding: 53.7, agentic: 27 },
  { id: "minimax/minimax-m2.7", intelligence: 38.1, coding: 52.6, agentic: 25.6 },
  { id: "thinkingmachines/inkling", intelligence: 40.7, coding: 52.1, agentic: 32.3 },
  { id: "anthropic/claude-sonnet-4.5", intelligence: 36.4, coding: 52.1, agentic: 24.6 },
  { id: "x-ai/grok-build-0.1", intelligence: 39.8, coding: 51.5, agentic: 28 },
  { id: "openai/gpt-5.1", intelligence: 36.9, coding: 49.4, agentic: 21 },
  { id: "google/gemini-3.5-flash-lite", intelligence: 36.5, coding: 49.3, agentic: 26.8 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", intelligence: 37.8, coding: 49.3, agentic: 27.4 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", intelligence: 37.8, coding: 49.3, agentic: 27.4 },
  { id: "qwen/qwen3.5-397b-a17b", intelligence: 33.7, coding: 48.2, agentic: 19.8 },
  { id: "mistralai/mistral-medium-3-5", intelligence: 29.9, coding: 46.9, agentic: 19 },
  { id: "moonshotai/kimi-k2.5", intelligence: 35.4, coding: 46.8, agentic: 21.7 },
  { id: "z-ai/glm-4.6", intelligence: 28.7, coding: 45.8, agentic: 17.7 },
  { id: "qwen/qwen3.5-122b-a10b", intelligence: 32.3, coding: 45.7, agentic: 20.7 },
  { id: "z-ai/glm-4.7", intelligence: 33.7, coding: 45.3, agentic: 25.4 },
  { id: "deepseek/deepseek-v3.2", intelligence: 32, coding: 44.2, agentic: 18.3 },
  { id: "anthropic/claude-haiku-4.5", intelligence: 29.6, coding: 43.9, agentic: 16.4 },
  { id: "deepseek/deepseek-v3.1-terminus", intelligence: 30.4, coding: 43.5, agentic: 18.1 },
  { id: "google/gemma-4-31b-it", intelligence: 29.4, coding: 43.4, agentic: 14.4 },
  { id: "google/gemma-4-31b-it:free", intelligence: 29.4, coding: 43.4, agentic: 14.4 },
  { id: "inclusionai/ring-2.6-1t", intelligence: 30.6, coding: 42.8, agentic: 18.9 },
  { id: "x-ai/grok-4.3", intelligence: 37.6, coding: 42.2, agentic: 24.1 },
  { id: "qwen/qwen3.6-35b-a3b", intelligence: 31.6, coding: 41.9, agentic: 21.4 },
  { id: "openai/o1", coding: 39.7 },
  { id: "stepfun/step-3.7-flash", intelligence: 30.3, coding: 39.6, agentic: 21.5 },
  { id: "google/gemma-4-26b-a4b-it", intelligence: 25.7, coding: 39.3, agentic: 11 },
  { id: "google/gemma-4-26b-a4b-it:free", intelligence: 25.7, coding: 39.3, agentic: 11 },
  { id: "openai/gpt-5", intelligence: 34.7, coding: 37.8, agentic: 25.7 },
  { id: "nvidia/nemotron-3-super-120b-a12b", intelligence: 25.4, coding: 37.7, agentic: 8.7 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", intelligence: 25.4, coding: 37.7, agentic: 8.7 },
  { id: "anthropic/claude-sonnet-4", intelligence: 28.9, coding: 37.6, agentic: 16.6 },
  { id: "qwen/qwen3.5-35b-a3b", intelligence: 24, coding: 37, agentic: 11.8 },
  { id: "cohere/north-mini-code:free", intelligence: 19.8, coding: 36.5, agentic: 3.1 },
  { id: "qwen/qwen3-coder-next", intelligence: 21.1, coding: 36.2, agentic: 8.8 },
  { id: "google/gemini-3.1-flash-lite-preview", intelligence: 25, coding: 34.7, agentic: 6.2 },
  { id: "google/gemini-2.5-pro", intelligence: 25.8, coding: 33.3, agentic: 7.1 },
  { id: "mistralai/devstral-2512", intelligence: 19.2, coding: 31.3, agentic: 10.6 },
  { id: "inception/mercury-2", intelligence: 21.4, coding: 31.1, agentic: 9.6 },
  { id: "openai/gpt-oss-120b", intelligence: 23.8, coding: 30.4, agentic: 13.2 },
  { id: "qwen/qwen3.5-9b", intelligence: 21.4, coding: 28.7, agentic: 7.4 },
  { id: "cohere/command-a", intelligence: 22.5, coding: 27.8, agentic: 9.2 },
  { id: "mistralai/mistral-small-2603", intelligence: 19.6, coding: 26.6, agentic: 4.7 },
  { id: "arcee-ai/trinity-large-thinking", intelligence: 18.2, coding: 25.8, agentic: 3.7 },
  { id: "inclusionai/ling-2.6-flash", intelligence: 14.1, coding: 25.3, agentic: 2.3 },
  { id: "deepseek/deepseek-r1", intelligence: 18.5, coding: 24.6, agentic: 3.1 },
  { id: "openai/gpt-4o-2024-05-13", coding: 24.2 },
  { id: "amazon/nova-2-lite-v1", intelligence: 18.2, coding: 23, agentic: 3.1 },
  { id: "qwen/qwen3-235b-a22b-thinking-2507", intelligence: 19.6, coding: 22.1, agentic: 3.8 },
  { id: "openai/gpt-4-turbo", coding: 21.5 },
  { id: "deepseek/deepseek-chat-v3-0324", intelligence: 15.4, coding: 21.2, agentic: 1.5 },
  { id: "moonshotai/kimi-k2-thinking", intelligence: 17.3, coding: 21, agentic: 1.8 },
  { id: "openai/gpt-oss-20b", intelligence: 14.9, coding: 20.7, agentic: 3.1 },
  { id: "openai/gpt-oss-20b:free", intelligence: 14.9, coding: 20.7, agentic: 3.1 },
  { id: "mistralai/mistral-medium-3.1", intelligence: 14.7, coding: 20.5, agentic: 6.2 },
  { id: "openai/gpt-4.1-mini", intelligence: 14.8, coding: 20.2, agentic: 1.7 },
  { id: "mistralai/mistral-large-2512", intelligence: 15.9, coding: 20.1, agentic: 5.5 },
  { id: "qwen/qwen3-next-80b-a3b-thinking", intelligence: 16.7, coding: 17.4, agentic: 2.1 },
  { id: "meta-llama/llama-4-maverick", intelligence: 14.3, coding: 16.3, agentic: 1.3 },
  { id: "openai/o3-mini-high", intelligence: 15.6, coding: 16.3, agentic: 1.7 },
  { id: "upstage/solar-pro-3", intelligence: 14.1, coding: 16.2, agentic: 2.7 },
  { id: "openai/gpt-5-mini", intelligence: 25.3, coding: 15.6, agentic: 19.4 },
  { id: "qwen/qwen3-32b", intelligence: 11.5, coding: 15.3, agentic: 1.8 },
  { id: "nvidia/nemotron-3-nano-30b-a3b", intelligence: 14.2, coding: 14.4, agentic: 2 },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free", intelligence: 14.2, coding: 14.4, agentic: 2 },
  { id: "mistralai/ministral-14b-2512", intelligence: 11.1, coding: 14.4, agentic: 2.2 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", coding: 13.8 },
  { id: "qwen/qwen3-14b", intelligence: 10.4, coding: 13.8, agentic: 1.8 },
  { id: "openai/gpt-4", coding: 13.1 },
  { id: "qwen/qwen3-30b-a3b-thinking-2507", intelligence: 14.4, coding: 12.1, agentic: 1.8 },
  { id: "meta-llama/llama-3.3-70b-instruct", intelligence: 9.4, coding: 11.9, agentic: 0.3 },
  { id: "openai/gpt-4o-mini", coding: 11.4, agentic: 1 },
  { id: "openai/gpt-4.1-nano", intelligence: 9.6, coding: 11.1, agentic: 1.2 },
  { id: "openai/gpt-3.5-turbo", coding: 10.7 },
  { id: "google/gemma-3-27b-it", intelligence: 7.4, coding: 10.1, agentic: 0.3 },
  { id: "mistralai/ministral-8b-2512", intelligence: 9, coding: 9.7, agentic: 1.2 },
  { id: "ibm-granite/granite-4.1-8b", coding: 9.5 },
  { id: "qwen/qwen3-8b", intelligence: 8.3, coding: 9, agentic: 1.5 },
  { id: "meta-llama/llama-4-scout", intelligence: 10, coding: 8.2, agentic: 1.1 },
  { id: "google/gemma-3-12b-it", intelligence: 5.5, coding: 5.8, agentic: 0.3 },
  { id: "meta-llama/llama-3.1-8b-instruct", intelligence: 7.6, coding: 5.4, agentic: 0.5 },
  { id: "mistralai/ministral-3b-2512", intelligence: 6.8, coding: 4.8, agentic: 1.6 },
  { id: "google/gemma-3n-e4b-it", coding: 3.2 },
  { id: "google/gemma-3-4b-it", coding: 2.7 },
]

/**
 * Canonical key for an id. This is a total, deterministic normalization —
 * lowercase and unify `.` with `-` — not similarity matching. OpenRouter
 * writes "anthropic/claude-opus-4.8" where models.dev writes
 * "anthropic/claude-opus-4-8"; both collapse to one key with no collisions.
 * Substring or prefix matching stays forbidden: it would let a "-mini"
 * derivative inherit its flagship's score.
 */
export function qualityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, "-")
}

/** Parse the OpenRouter models payload into quality entries. */
export function parseOpenRouterModels(payload: unknown): QualityEntry[] {
  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const entries: QualityEntry[] = []
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue
    const record = item as Record<string, any>
    const id = typeof record.id === "string" ? record.id : undefined
    const aa = record.benchmarks?.artificial_analysis
    if (!id || typeof aa !== "object" || aa === null) continue
    const entry: QualityEntry = { id }
    if (typeof aa.intelligence_index === "number") entry.intelligence = aa.intelligence_index
    if (typeof aa.coding_index === "number") entry.coding = aa.coding_index
    if (typeof aa.agentic_index === "number") entry.agentic = aa.agentic_index
    if (entry.intelligence !== undefined || entry.coding !== undefined) entries.push(entry)
  }
  return entries
}

export interface QualityIndex {
  match(modelId: string, displayName?: string): QualityMatch | undefined
  size: number
}

/**
 * Build an exact-match index over quality entries. `live` marks a fresh fetch
 * rather than the bundled snapshot.
 */
export function buildQualityIndex(entries: QualityEntry[], live: boolean): QualityIndex {
  const byKey = new Map<string, QualityEntry>()
  // Model segment alone, kept only while it stays unambiguous. Resellers and
  // gateways serve the same model under their own provider id
  // (commandcode/deepseek-v4-pro is deepseek/deepseek-v4-pro), so without this
  // almost nothing on an aggregator-heavy setup gets a score. Ambiguous
  // segments are dropped rather than guessed.
  const bySuffix = new Map<string, QualityEntry | null>()
  for (const entry of entries) {
    const key = qualityKey(entry.id)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, entry)
    const suffix = key.slice(key.lastIndexOf("/") + 1)
    if (!suffix) continue
    if (!bySuffix.has(suffix)) bySuffix.set(suffix, entry)
    else if (bySuffix.get(suffix)?.id !== entry.id) bySuffix.set(suffix, null)
  }
  const source = live ? "openrouter-live" : "openrouter-snapshot"
  return {
    size: byKey.size,
    match(modelId) {
      const key = qualityKey(modelId)
      // Try the full id, then the vendor-qualified remainder (aggregators like
      // openrouter/ and github-models/ prefix their own id onto vendor/model),
      // then the unambiguous bare model segment. Every step is exact string
      // equality — never substring, which would let a "-mini" derivative
      // inherit its flagship's score.
      const candidates = [key]
      const firstSlash = key.indexOf("/")
      const remainder = firstSlash >= 0 ? key.slice(firstSlash + 1) : ""
      if (remainder.includes("/")) candidates.push(remainder)
      // Prefer the coding index: these roles all write code. Fall back to the
      // general index and record which scale was used, because the two are not
      // comparable across models.
      const resolve = (entry: QualityEntry | null | undefined): QualityMatch | undefined => {
        if (!entry) return undefined
        const score = entry.coding ?? entry.intelligence
        if (score === undefined) return undefined
        return {
          score,
          scale: entry.coding !== undefined ? "aa-coding-index" : "aa-intelligence-index",
          intelligence: entry.intelligence,
          coding: entry.coding,
          agentic: entry.agentic,
          matchedId: entry.id,
          source,
        }
      }

      for (const candidate of candidates) {
        const match = resolve(byKey.get(candidate))
        if (match) return match
      }
      // Last resort: the bare model segment, only where it is unambiguous.
      return resolve(bySuffix.get(key.slice(key.lastIndexOf("/") + 1)))
    },
  }
}
