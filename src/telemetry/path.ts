import { homedir } from "node:os"
import { join, resolve } from "node:path"

export function defaultTelemetryDirectory(): string {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(stateHome, "opencode-agent-flows")
}

export function expandPath(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return resolve(path)
}
