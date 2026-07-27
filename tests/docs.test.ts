import { describe, expect, test } from "bun:test"
import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const docs = join(root, "docs")

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)))
    else if (entry.name.endsWith(".md")) files.push(full)
  }
  return files
}

describe("docsify site", () => {
  test("has the files docsify needs", async () => {
    for (const file of ["index.html", "_sidebar.md", "_coverpage.md", "README.md", ".nojekyll"]) {
      expect(await exists(join(docs, file))).toBe(true)
    }
  })

  test("index.html enables the sidebar, coverpage, and search", async () => {
    const html = await readFile(join(docs, "index.html"), "utf8")
    expect(html).toContain("loadSidebar: true")
    expect(html).toContain("coverpage: true")
    expect(html).toContain("search")
    expect(html).toContain("docsify@5")
    expect(html).toContain("core-dark.min.css")
    expect(html).toContain("prefers-color-scheme: dark")
  })

  test("every sidebar link points at a real file", async () => {
    const sidebar = await readFile(join(docs, "_sidebar.md"), "utf8")
    const links = [...sidebar.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])
    expect(links.length).toBeGreaterThan(5)
    for (const link of links) {
      if (link.startsWith("http")) continue
      // "/" is the docs home, which docsify resolves to README.md.
      const target = link === "/" ? "README.md" : link.replace(/^\//, "")
      expect({ link, exists: await exists(join(docs, target)) }).toEqual({ link, exists: true })
    }
  })

  test("relative links inside docs pages resolve", async () => {
    for (const file of await markdownFiles(docs)) {
      const contents = await readFile(file, "utf8")
      for (const match of contents.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g)) {
        const link = match[1]
        if (link.startsWith("http")) continue
        const target = link.startsWith("/") ? join(docs, link.slice(1)) : resolve(dirname(file), link)
        expect({ file: file.replace(root, ""), link, exists: await exists(target) }).toEqual({
          file: file.replace(root, ""),
          link,
          exists: true,
        })
      }
    }
  })
})
