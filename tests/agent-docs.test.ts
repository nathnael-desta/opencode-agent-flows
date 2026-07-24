import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe("agent guide", () => {
  test("AGENTS.md and CLAUDE.md stay identical", async () => {
    const [agents, claude] = await Promise.all([
      readFile(join(root, "AGENTS.md"), "utf8"),
      readFile(join(root, "CLAUDE.md"), "utf8"),
    ])
    // They are mirrors kept under two names because different tools look for
    // different filenames. Changing one requires changing the other.
    expect(claude).toBe(agents)
  })

  test("the guide states the mirroring rule", async () => {
    const agents = await readFile(join(root, "AGENTS.md"), "utf8")
    expect(agents).toContain("CLAUDE.md")
    expect(agents).toMatch(/identical|in sync/i)
  })
})
