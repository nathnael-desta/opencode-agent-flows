/**
 * Detect whether Google Antigravity (the `agy` CLI, on a Google AI Pro
 * subscription) is available, so the orchestrator can route vision and
 * large-context work to it as an effectively-free bundled-credit helper.
 *
 * The Antigravity tools themselves live in a separate plugin
 * (opencode-antigravity-delegate); this only detects the CLI and surfaces it.
 */

export interface AntigravityStatus {
  available: boolean
  /** Gemini/Antigravity models the account exposes, if detectable. */
  models: string[]
  detail: string
}

export interface ProbeResult {
  stdout: string
  code: number | null
}

export type ProbeRunner = (command: string, args: string[]) => Promise<ProbeResult>

/** The Gemini roles Flash is genuinely best at, for routing guidance. */
export const ANTIGRAVITY_STRENGTHS = [
  "image, screenshot, UI, PDF, diagram, and chart analysis (multimodal vision)",
  "whole-repo, whole-log, and other large-context reads (1M-token window)",
  "fast, cheap bulk triage, classification, and first-pass drafts",
  "non-blocking background helper work (summaries, doc drafts)",
]

/** Probe the CLI. Pure over an injected runner so it is testable offline. */
export async function detectAntigravity(run: ProbeRunner, command = "agy"): Promise<AntigravityStatus> {
  let version: ProbeResult
  try {
    version = await run(command, ["--version"])
  } catch (error) {
    return { available: false, models: [], detail: `${command} not runnable: ${message(error)}` }
  }
  if (version.code !== 0) return { available: false, models: [], detail: `${command} --version exited ${version.code}` }

  let models: string[] = []
  try {
    const listed = await run(command, ["models"])
    if (listed.code === 0)
      models = listed.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /gemini/i.test(line))
  } catch {
    // Model list is a nicety, not required for availability.
  }
  return { available: true, models, detail: `agy ${version.stdout.trim() || "installed"}` }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One-paragraph routing guidance for the orchestrator, given detection. */
export function formatAntigravityStatus(status: AntigravityStatus): string {
  if (!status.available)
    return `Antigravity (Google AI Pro / agy CLI) is not available here: ${status.detail}. Install the agy CLI and log in, plus the opencode-antigravity-delegate plugin, to route vision and large-context work to Gemini as a bundled-credit helper.`
  const models = status.models.length ? ` Models: ${status.models.slice(0, 8).join(", ")}${status.models.length > 8 ? ", ..." : ""}.` : ""
  return [
    `Antigravity is available (${status.detail}).${models}`,
    "If the antigravity_delegate, antigravity_vision, and antigravity_background tools are loaded, treat Gemini as an effectively-free bundled-credit helper for:",
    ...ANTIGRAVITY_STRENGTHS.map((s) => `- ${s}`),
    "Prefer Gemini 3.6 Flash, using gemini-3.6-flash-high for difficult analysis; do not upgrade helper work to Gemini 3.1 Pro.",
    "Use only Google's own Gemini models through Antigravity. It also serves Claude and gpt-oss, but routing a third-party model through Antigravity adds that vendor's terms on top of Google's, so those are not used.",
    "Keep the agentic loop, escalation, and milestone review on your primary models — Gemini Flash is weak at long-horizon autonomy.",
  ].join("\n")
}
