import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

interface CacheEnvelope<T> {
  fetchedAt: number
  data: T
}

/** Return cached data if it exists and is within `ttlMs`, else undefined. */
export async function readCache<T>(path: string, ttlMs: number): Promise<T | undefined> {
  try {
    const envelope = JSON.parse(await readFile(path, "utf8")) as CacheEnvelope<T>
    if (typeof envelope.fetchedAt === "number" && Date.now() - envelope.fetchedAt <= ttlMs) return envelope.data
  } catch {
    // Missing or corrupt cache — treat as a miss.
  }
  return undefined
}

/** Return the last cached data regardless of age (used as a stale fallback). */
export async function readStaleCache<T>(path: string): Promise<T | undefined> {
  try {
    const envelope = JSON.parse(await readFile(path, "utf8")) as CacheEnvelope<T>
    return envelope.data
  } catch {
    return undefined
  }
}

export async function writeCache<T>(path: string, data: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEnvelope<T>), "utf8")
  await rename(temporary, path)
}

/** Fetch text with a hard timeout so a slow endpoint never hangs the tool. */
export async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "opencode-agent-flows" } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}
