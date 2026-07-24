import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, rm, symlink } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

const executeFile = promisify(execFile)

export interface RiftProbe {
  installed: boolean
  initialized: boolean
  /** The CLI's own explanation, which is the useful part of a failure. */
  detail: string
}

/** Prefer a failed command's stderr; its message is the diagnosis. */
export function describeProcessError(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim().split(/\r?\n/)[0]
  return error instanceof Error ? error.message : String(error)
}
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".rift",
  "node_modules",
  ".pnpm-store",
  "target",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vite",
  ".parcel-cache",
  ".cache",
  "dist",
  "build",
  "coverage",
])

export interface WorkspaceEntry {
  type: "file" | "symlink"
  mode: number
  digest: string
}

export type WorkspaceManifest = Map<string, WorkspaceEntry>

export interface RiftCommandResult {
  stdout: string
  stderr: string
}

export type RiftCommandRunner = (command: string, args: string[], cwd: string) => Promise<RiftCommandResult>

const defaultRunner: RiftCommandRunner = async (command, args, cwd) => {
  const result = await executeFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  return { stdout: result.stdout, stderr: result.stderr }
}

function safeName(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  if (!value) throw new Error("Rift workspace name must contain a letter or number")
  return value
}

function safeRelativePath(path: string): string {
  const value = path.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!value || value.startsWith("/") || value === ".." || value.startsWith("../") || value.includes("/../")) {
    throw new Error(`Unsafe workspace path: ${path}`)
  }
  return value
}

function sameEntry(left?: WorkspaceEntry, right?: WorkspaceEntry): boolean {
  return left?.type === right?.type && left?.mode === right?.mode && left?.digest === right?.digest
}

function validateSymlinkTarget(destinationRoot: string, path: string, target: string): void {
  const resolvedRoot = resolve(destinationRoot)
  const resolvedTarget = resolve(dirname(join(resolvedRoot, path)), target)
  if (isAbsolute(target) || (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error(`Rift symlink escapes the source workspace: ${path} -> ${target}`)
  }
}

async function walk(root: string, directory: string, output: WorkspaceManifest): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const absolute = join(directory, entry.name)
    const path = relative(root, absolute).split(sep).join("/")
    if (entry.isDirectory()) {
      await walk(root, absolute, output)
      continue
    }
    const stat = await lstat(absolute)
    if (entry.isSymbolicLink()) {
      output.set(path, { type: "symlink", mode: stat.mode & 0o777, digest: await readlink(absolute) })
      continue
    }
    if (!entry.isFile()) continue
    const digest = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex")
    output.set(path, { type: "file", mode: stat.mode & 0o777, digest })
  }
}

export async function workspaceManifest(root: string): Promise<WorkspaceManifest> {
  const output: WorkspaceManifest = new Map()
  await walk(resolve(root), resolve(root), output)
  return output
}

export function changedWorkspacePaths(base: WorkspaceManifest, candidate: WorkspaceManifest): string[] {
  return [...new Set([...base.keys(), ...candidate.keys()])].filter((path) => !sameEntry(base.get(path), candidate.get(path))).sort()
}

async function applyPath(sourceRoot: string, destinationRoot: string, path: string, entry?: WorkspaceEntry): Promise<void> {
  const source = join(sourceRoot, path)
  const destination = join(destinationRoot, path)
  let symlinkTarget: string | undefined
  if (entry?.type === "symlink") {
    symlinkTarget = await readlink(source)
    validateSymlinkTarget(destinationRoot, path, symlinkTarget)
  }
  await rm(destination, { recursive: true, force: true })
  if (!entry) return
  await mkdir(dirname(destination), { recursive: true })
  if (entry.type === "symlink") {
    await symlink(symlinkTarget!, destination)
    return
  }
  await copyFile(source, destination)
  await chmod(destination, entry.mode)
}

export interface RiftWorkerResult {
  taskID: string
  workspace: string
  manifest: WorkspaceManifest
  declaredFiles: string[]
}

export async function integrateRiftWorkers(input: { source: string; baseline: WorkspaceManifest; workers: RiftWorkerResult[] }): Promise<string[]> {
  const current = await workspaceManifest(input.source)
  const desired = new Map<string, { workspace: string; entry?: WorkspaceEntry }>()

  for (const worker of input.workers) {
    const changed = changedWorkspacePaths(input.baseline, worker.manifest)
    const declared = new Set(worker.declaredFiles.map(safeRelativePath))
    const undeclared = changed.filter((path) => !declared.has(path))
    const unchanged = [...declared].filter((path) => !changed.includes(path))
    if (undeclared.length > 0 || unchanged.length > 0) {
      throw new Error(`Rift task ${worker.taskID} file report mismatch; undeclared changes: ${undeclared.join(", ") || "none"}; unchanged declarations: ${unchanged.join(", ") || "none"}`)
    }
    for (const path of changed) {
      const next = worker.manifest.get(path)
      const existing = desired.get(path)
      if (existing && !sameEntry(existing.entry, next)) throw new Error(`Rift workers conflict on ${path}`)
      desired.set(path, { workspace: worker.workspace, entry: next })
    }
  }

  for (const [path, target] of desired) {
    const present = current.get(path)
    if (!sameEntry(present, input.baseline.get(path)) && !sameEntry(present, target.entry)) {
      throw new Error(`Source path changed after the Rift baseline: ${path}`)
    }
    if (target.entry?.type === "symlink") validateSymlinkTarget(input.source, path, target.entry.digest)
  }
  const operations = [...desired].sort(([leftPath, left], [rightPath, right]) => {
    const leftDelete = left.entry === undefined
    const rightDelete = right.entry === undefined
    if (leftDelete !== rightDelete) return leftDelete ? -1 : 1
    const depth = (path: string) => path.split("/").length
    return leftDelete ? depth(rightPath) - depth(leftPath) : depth(leftPath) - depth(rightPath)
  })
  for (const [path, target] of operations) await applyPath(target.workspace, input.source, path, target.entry)
  return [...desired.keys()].sort()
}

export class RiftClient {
  constructor(
    private readonly command = "rift",
    private readonly runner: RiftCommandRunner = defaultRunner,
  ) {}

  /**
   * Report whether the CLI is installed and whether this directory is an
   * initialized Rift workspace.
   *
   * There is deliberately no `--version` call: the real CLI has no such flag
   * and exits 2 on it, which made a perfectly working install report as
   * unavailable. `--help` is the availability probe; `list` distinguishes
   * "installed but not initialized here" and surfaces the actual reason, such
   * as a filesystem without copy-on-write reflinks.
   */
  async probe(cwd: string): Promise<RiftProbe> {
    try {
      await this.runner(this.command, ["--help"], cwd)
    } catch (error) {
      return { installed: false, initialized: false, detail: describeProcessError(error) }
    }
    try {
      const result = await this.runner(this.command, ["list"], cwd)
      return { installed: true, initialized: true, detail: result.stdout.trim() || "workspace initialized" }
    } catch (error) {
      return { installed: true, initialized: false, detail: describeProcessError(error) }
    }
  }

  async init(cwd: string): Promise<void> {
    await this.runner(this.command, ["init", "--here"], cwd)
  }

  async create(from: string, name: string, runHooks: boolean): Promise<string> {
    const args = ["create", "--name", safeName(name)]
    if (!runHooks) args.push("--no-hooks")
    const result = await this.runner(this.command, args, from)
    const path = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!path) throw new Error("Rift did not return a workspace path")
    return isAbsolute(path) ? path : resolve(from, path)
  }

  async remove(path: string): Promise<void> {
    await this.runner(this.command, ["remove"], path)
  }

  async gc(cwd: string): Promise<void> {
    await this.runner(this.command, ["gc"], cwd)
  }
}
