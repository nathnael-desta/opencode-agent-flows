/**
 * The orchestrator prompt is resent as system context on every turn, so text in
 * it is paid for continuously. Guidance for optional third-party tools was ~27%
 * of it and described tools that may not be installed at all.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../plugin.js"
import { flows } from "../src/flows/index.js"

async function promptFor(config: Record<string, any>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gate-"))
  try {
    const hooks: any = await plugin({}, { telemetry: { reportDir: directory } })
    await hooks.config(config)
    return config.agent.orchestrator.prompt as string
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("optional-tool guidance is gated on the tools existing", () => {
  test("drops both blocks when neither tool is installed", async () => {
    const prompt = await promptFor({ plugin: [], mcp: {} })
    expect(prompt).not.toContain("antigravity_vision")
    expect(prompt).not.toContain("Browser Control MCP tools")
    // Core routing policy must survive.
    expect(prompt).toContain("Classify each request")
  })

  test("keeps both when both are installed", async () => {
    const prompt = await promptFor({ plugin: ["opencode-antigravity-delegate"], mcp: { "browser-control": {} } })
    expect(prompt).toContain("antigravity_vision")
    expect(prompt).toContain("Browser Control MCP tools")
  })

  test("keeps only the block whose tool is present", async () => {
    const prompt = await promptFor({ plugin: ["file:///x/opencode-antigravity-delegate/plugin.ts"], mcp: {} })
    expect(prompt).toContain("antigravity_vision")
    expect(prompt).not.toContain("Browser Control MCP tools")
  })

  test("gating a lean config does not corrupt the shared flow definition", async () => {
    // config.agent[name] holds a reference to the module-level flow object, so
    // mutating it in place would strip the guidance for every later instance.
    const before = flows["openai-commandcode-router"].agents.orchestrator.prompt ?? ""
    await promptFor({ plugin: [], mcp: {} })
    expect(flows["openai-commandcode-router"].agents.orchestrator.prompt).toBe(before)
    // And a later instance that does have the tools still gets the full prompt.
    const full = await promptFor({ plugin: ["opencode-antigravity-delegate"], mcp: { "browser-control": {} } })
    expect(full).toContain("antigravity_vision")
  })

  test("gating measurably shrinks the per-turn prompt", async () => {
    const full = await promptFor({ plugin: ["opencode-antigravity-delegate"], mcp: { "browser-control": {} } })
    const lean = await promptFor({ plugin: [], mcp: {} })
    expect(full.length - lean.length).toBeGreaterThan(600)
  })
})

describe("gating constants stay in sync with the built-in flow", () => {
  test("both optional blocks appear verbatim in the built-in prompt", async () => {
    // Gating removes these by exact match. If the built-in flow's copy drifts
    // from the shared constant, removal silently stops working and the user
    // keeps paying for guidance about tools they do not have.
    const { ANTIGRAVITY_GUIDANCE, BROWSER_GUIDANCE } = await import("../src/orchestration/roles.js")
    const builtin = flows["openai-commandcode-router"].agents.orchestrator.prompt ?? ""
    expect(builtin.includes(ANTIGRAVITY_GUIDANCE)).toBe(true)
    expect(builtin.includes(BROWSER_GUIDANCE)).toBe(true)
  })

  test("the built-in flow is gateable end to end", async () => {
    const lean = await promptFor({ plugin: [], mcp: {} })
    expect(lean).not.toContain("Browser Control MCP tools")
    expect(lean).not.toContain("antigravity_vision")
  })
})

describe("prompts route to the operating-policy skills", () => {
  test("both prompts carry the cost and correctness rules that were measured", async () => {
    const { composeOrchestratorPrompt } = await import("../src/orchestration/roles.js")
    const prompts = [
      flows["openai-commandcode-router"].agents.orchestrator.prompt ?? "",
      composeOrchestratorPrompt({ antigravity: true, browser: true }),
    ]
    for (const prompt of prompts) {
      // The measured operating detail lives in the skills now; the prompt must
      // still route to them, or the policy never loads at all.
      expect(prompt).toContain("browser-control-operations")
      expect(prompt).toContain("antigravity-delegation")
    }
  })
})

describe("setup tells the user how to get the skills", () => {
  test("the interview names the npm install command and both skills", async () => {
    const { SETUP_COMMAND_TEMPLATE } = await import("../src/orchestration/setup-prompt.js")
    expect(SETUP_COMMAND_TEMPLATE).toContain("skills@latest add nathnael-desta/skills")
    expect(SETUP_COMMAND_TEMPLATE).toContain("browser-control-operations")
    expect(SETUP_COMMAND_TEMPLATE).toContain("antigravity-delegation")
  })

  test("the interview presents the whole ecosystem, not just this plugin", async () => {
    // A new user should see every add-on and its exact command in one place,
    // rather than discovering them one repository at a time.
    const { SETUP_COMMAND_TEMPLATE } = await import("../src/orchestration/setup-prompt.js")
    for (const pointer of [
      "antigravity.google/cli/install.sh",
      "opencode-antigravity-delegate",
      "opencode-commandcode-provider",
      "COMMANDCODE_API_KEY",
      "setup-github-beads",
    ]) {
      expect({ pointer, present: SETUP_COMMAND_TEMPLATE.includes(pointer) }).toEqual({ pointer, present: true })
    }
  })
})
