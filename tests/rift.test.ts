import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedWorkspacePaths, integrateRiftWorkers, RiftClient, workspaceManifest } from "../src/rift.js"

const temporaryDirectories: string[] = []

async function directory(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `agent-flow-rift-${name}-`))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Rift workspace integration", () => {
  test("detects files, deletions, and symlinks while excluding generated directories", async () => {
    const baseline = await directory("baseline")
    const worker = await directory("worker")
    await writeFile(join(baseline, "changed.txt"), "before")
    await writeFile(join(baseline, "deleted.txt"), "delete me")
    await writeFile(join(worker, "changed.txt"), "after")
    await writeFile(join(worker, "added.txt"), "new")
    await symlink("changed.txt", join(worker, "link.txt"))
    await mkdir(join(worker, "node_modules"))
    await writeFile(join(worker, "node_modules", "ignored.js"), "ignored")

    const changed = changedWorkspacePaths(await workspaceManifest(baseline), await workspaceManifest(worker))

    expect(changed).toEqual(["added.txt", "changed.txt", "deleted.txt", "link.txt"])
  })

  test("integrates disjoint declared worker changes onto a dirty baseline", async () => {
    const source = await directory("source")
    const baseline = await directory("baseline")
    const workerA = await directory("worker-a")
    const workerB = await directory("worker-b")
    for (const root of [source, baseline, workerA, workerB]) {
      await writeFile(join(root, "already-dirty.txt"), "user state")
      await writeFile(join(root, "a.txt"), "a0")
      await writeFile(join(root, "b.txt"), "b0")
    }
    await writeFile(join(workerA, "a.txt"), "a1")
    await writeFile(join(workerB, "b.txt"), "b1")
    const baselineManifest = await workspaceManifest(baseline)

    const changed = await integrateRiftWorkers({
      source,
      baseline: baselineManifest,
      workers: [
        { taskID: "a", workspace: workerA, manifest: await workspaceManifest(workerA), declaredFiles: ["a.txt"] },
        { taskID: "b", workspace: workerB, manifest: await workspaceManifest(workerB), declaredFiles: ["b.txt"] },
      ],
    })

    expect(changed).toEqual(["a.txt", "b.txt"])
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("a1")
    expect(await readFile(join(source, "b.txt"), "utf8")).toBe("b1")
    expect(await readFile(join(source, "already-dirty.txt"), "utf8")).toBe("user state")
  })

  test("rejects undeclared worker edits and live source conflicts", async () => {
    const source = await directory("source")
    const baseline = await directory("baseline")
    const worker = await directory("worker")
    for (const root of [source, baseline, worker]) await writeFile(join(root, "file.txt"), "base")
    await writeFile(join(worker, "file.txt"), "worker")
    const baselineManifest = await workspaceManifest(baseline)
    const manifest = await workspaceManifest(worker)

    await expect(
      integrateRiftWorkers({
        source,
        baseline: baselineManifest,
        workers: [{ taskID: "worker", workspace: worker, manifest, declaredFiles: [] }],
      }),
    ).rejects.toThrow("undeclared changes")

    await writeFile(join(source, "file.txt"), "new user edit")
    await expect(
      integrateRiftWorkers({
        source,
        baseline: baselineManifest,
        workers: [{ taskID: "worker", workspace: worker, manifest, declaredFiles: ["file.txt"] }],
      }),
    ).rejects.toThrow("changed after the Rift baseline")
  })

  test("rejects worker symlinks that escape the source workspace", async () => {
    const source = await directory("source")
    const baseline = await directory("baseline")
    const worker = await directory("worker")
    await symlink("/etc/passwd", join(worker, "escape"))

    await expect(integrateRiftWorkers({
      source,
      baseline: await workspaceManifest(baseline),
      workers: [{ taskID: "worker", workspace: worker, manifest: await workspaceManifest(worker), declaredFiles: ["escape"] }],
    })).rejects.toThrow("symlink escapes")
  })

  test("integrates directory-to-file and file-to-directory replacements", async () => {
    const source = await directory("source")
    const baseline = await directory("baseline")
    const worker = await directory("worker")
    for (const root of [source, baseline]) {
      await mkdir(join(root, "directory"))
      await writeFile(join(root, "directory", "old.txt"), "old")
      await writeFile(join(root, "file"), "old file")
    }
    await writeFile(join(worker, "directory"), "now a file")
    await mkdir(join(worker, "file"))
    await writeFile(join(worker, "file", "new.txt"), "now a directory")

    await integrateRiftWorkers({
      source,
      baseline: await workspaceManifest(baseline),
      workers: [{
        taskID: "replacement",
        workspace: worker,
        manifest: await workspaceManifest(worker),
        declaredFiles: ["directory", "directory/old.txt", "file", "file/new.txt"],
      }],
    })

    expect(await readFile(join(source, "directory"), "utf8")).toBe("now a file")
    expect(await readFile(join(source, "file", "new.txt"), "utf8")).toBe("now a directory")
  })

  test("uses the Rift CLI without shell interpolation", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []
    const client = new RiftClient("custom-rift", async (command, args, cwd) => {
      calls.push({ command, args, cwd })
      return { stdout: args[0] === "create" ? "/tmp/rifts/task\n" : "", stderr: "" }
    })

    // Probing uses --help and list; the real CLI has no --version flag.
    expect(await client.probe("/repo")).toMatchObject({ installed: true, initialized: true })
    expect(await client.create("/repo", "Task A", false)).toBe("/tmp/rifts/task")
    expect(calls).toEqual([
      { command: "custom-rift", args: ["--help"], cwd: "/repo" },
      { command: "custom-rift", args: ["list"], cwd: "/repo" },
      { command: "custom-rift", args: ["create", "--name", "task-a", "--no-hooks"], cwd: "/repo" },
    ])
  })

  test("probe separates a missing CLI from an uninitialized workspace", async () => {
    const missing = new RiftClient("custom-rift", async () => {
      throw Object.assign(new Error("spawn custom-rift ENOENT"), { stderr: "" })
    })
    expect(await missing.probe("/repo")).toMatchObject({ installed: false, initialized: false })

    const uninitialized = new RiftClient("custom-rift", async (_command, args) => {
      if (args[0] === "--help") return { stdout: "Usage: rift <COMMAND>", stderr: "" }
      throw Object.assign(new Error("exit 1"), { stderr: "no initialized workspace found; run `rift init`" })
    })
    const probe = await uninitialized.probe("/repo")
    expect(probe).toMatchObject({ installed: true, initialized: false })
    expect(probe.detail).toContain("no initialized workspace found")
  })
})
