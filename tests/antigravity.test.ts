import { describe, expect, test } from "bun:test"
import { detectAntigravity, formatAntigravityStatus, type ProbeRunner } from "../src/orchestration/antigravity.js"

const available: ProbeRunner = async (_c, args) => {
  if (args[0] === "--version") return { stdout: "1.1.6", code: 0 }
  if (args[0] === "models") return { stdout: "gemini-3.6-flash-high\ngemini-3.1-pro-high\nclaude-sonnet-4-6\n", code: 0 }
  return { stdout: "", code: 1 }
}

describe("detectAntigravity", () => {
  test("reports available with the Gemini models when agy responds", async () => {
    const status = await detectAntigravity(available)
    expect(status.available).toBe(true)
    // Only Gemini models are surfaced (Claude is filtered out).
    expect(status.models).toEqual(["gemini-3.6-flash-high", "gemini-3.1-pro-high"])
    expect(status.detail).toContain("1.1.6")
  })

  test("reports unavailable when the binary is missing", async () => {
    const missing: ProbeRunner = async () => {
      throw Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" })
    }
    const status = await detectAntigravity(missing)
    expect(status.available).toBe(false)
    expect(status.detail).toContain("not runnable")
  })

  test("reports unavailable when --version exits non-zero", async () => {
    const status = await detectAntigravity(async () => ({ stdout: "", code: 1 }))
    expect(status.available).toBe(false)
  })

  test("stays available even if the model list fails", async () => {
    const status = await detectAntigravity(async (_c, args) => (args[0] === "--version" ? { stdout: "1.1.6", code: 0 } : { stdout: "", code: 1 }))
    expect(status.available).toBe(true)
    expect(status.models).toEqual([])
  })
})

describe("formatAntigravityStatus", () => {
  test("available guidance names the vision/large-context/bulk strengths", async () => {
    const text = formatAntigravityStatus(await detectAntigravity(available))
    expect(text).toContain("Antigravity is available")
    expect(text).toContain("antigravity_vision")
    expect(text).toContain("long-horizon autonomy")
    expect(text).toContain("only Google's own Gemini")
    expect(text).toContain("gemini-3.6-flash-high")
  })

  test("unavailable guidance says how to enable it", () => {
    const text = formatAntigravityStatus({ available: false, models: [], detail: "agy not runnable" })
    expect(text).toContain("not available")
    expect(text).toContain("opencode-antigravity-delegate")
  })
})
