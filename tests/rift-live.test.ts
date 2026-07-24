/**
 * Integration tests against the REAL rift CLI.
 *
 * These run only when a `rift` binary is on PATH, so the suite stays green on
 * machines without it. They pin the CLI contract the plugin depends on, which
 * is how the bogus `--version` probe was caught: the real CLI exits 2 on it, so
 * a working install reported as unavailable.
 *
 * Copy-on-write itself needs btrfs, native reflinks, or APFS. On other
 * filesystems these assert the failure is clean and diagnosable rather than
 * pretending isolation works.
 */
import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describeProcessError, RiftClient } from "../src/rift.js"

const run = promisify(execFile)

async function riftAvailable(): Promise<boolean> {
  try {
    await run("rift", ["--help"])
    return true
  } catch {
    return false
  }
}

async function supportsReflink(directory: string): Promise<boolean> {
  try {
    await writeFile(join(directory, "src.bin"), "probe", "utf8")
    await run("cp", ["--reflink=always", join(directory, "src.bin"), join(directory, "dst.bin")])
    return true
  } catch {
    return false
  }
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rift-live-"))
  await run("git", ["init", "-q", "."], { cwd: directory })
  await writeFile(join(directory, "file.txt"), "base\n", "utf8")
  await run("git", ["add", "-A"], { cwd: directory })
  await run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: directory })
  return directory
}

const available = await riftAvailable()
const describeLive = available ? describe : describe.skip

describeLive("rift CLI contract", () => {
  test("has no --version flag, so probing with it is wrong", async () => {
    // This is the defect these tests exist to prevent regressing.
    await expect(run("rift", ["--version"])).rejects.toThrow()
  })

  test("--help succeeds and is a valid availability probe", async () => {
    const result = await run("rift", ["--help"])
    expect(result.stdout).toContain("Usage: rift")
  })

  test("probe reports installed, and uninitialized with the CLI's own reason", async () => {
    const directory = await repository()
    try {
      const probe = await new RiftClient("rift").probe(directory)
      expect(probe.installed).toBe(true)
      expect(probe.initialized).toBe(false)
      expect(probe.detail.length).toBeGreaterThan(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("probe reports not installed for a missing binary", async () => {
    const probe = await new RiftClient("rift-does-not-exist-xyz").probe(tmpdir())
    expect(probe.installed).toBe(false)
  })

  test("init behaves according to filesystem support", async () => {
    const directory = await repository()
    try {
      const client = new RiftClient("rift")
      const reflink = await supportsReflink(directory)
      if (reflink) {
        // Supported filesystem: initialization must succeed and be visible.
        await client.init(directory)
        const probe = await client.probe(directory)
        expect(probe.initialized).toBe(true)
      } else {
        // Unsupported filesystem: must fail loudly, never silently "succeed".
        let failed = false
        let detail = ""
        try {
          await client.init(directory)
        } catch (error) {
          failed = true
          detail = describeProcessError(error)
        }
        expect(failed).toBe(true)
        expect(detail.toLowerCase()).toContain("copy-on-write")
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("rift error reporting", () => {
  test("describeProcessError prefers the command's stderr", () => {
    expect(describeProcessError({ stderr: "no initialized workspace found\nsecond line" })).toBe("no initialized workspace found")
    expect(describeProcessError(new Error("spawn ENOENT"))).toBe("spawn ENOENT")
    expect(describeProcessError({ stderr: "   " })).toContain("[object Object]")
  })
})
