# Browser and Frontend Verification

The orchestrator prompt instructs the primary agent to handle Playwright or
equivalent browser tools itself and split artifacts to the appropriate Gemini
3.6 Flash tool via Antigravity for analysis. This page explains when to offload
versus retain locally, the quota rationale, the recommended workflow, and its
limitations.

## When to offload

Route **visual artifacts** to `antigravity_vision`:

- Screenshots and rendered PDFs collected under the orchestrator's own control.
- You need a visual verdict that Gemini can return from pixels faster and
  cheaper than the primary model can read a text description.

Route **textual artifacts** to `antigravity_delegate`:

- Accessibility snapshots, console excerpts, network summaries, and text trace
  excerpts from the completed browser session.

**Binary Playwright traces** cannot be passed to either tool directly. Extract
a bounded set of representative screenshots or a human-readable text log from
the trace before routing.

Keep **the browser interaction itself** local:

- The orchestrator drives Playwright — clicks, navigation, form input, waiting
  for selectors, collecting snapshots.
- Never delegate individual clicks, steps, or multi-turn browser sequences to
  Gemini. Gemini is an artifact analyst, not a browser controller.
- Never run autonomous destructive flows or flows that sign into accounts at
  the orchestrator prompt level.

## Quota rationale

Describing browser artifacts in prose — layout geometry, color values, alignment
offsets, console logs, network waterfall details — burns primary-model context on
every turn. Routing visual artifacts to `antigravity_vision` and textual
artifacts to `antigravity_delegate` lets Gemini handle the inspection step.
Because Gemini on a Google AI Pro subscription is effectively free at the margin
(bundled credit), this routing can reduce expensive primary-model context without
adding metered cost.

## Recommended bounded workflow

1. **The orchestrator drives.** Open one Playwright browser session, navigate,
   interact, and collect artifacts locally.
2. **Split the artifacts.** After the session, separate screenshots and rendered
   PDFs (visual) from accessibility snapshots, console excerpts, network
   summaries, and text trace excerpts (textual). For binary Playwright traces,
   extract a bounded set of representative screenshots or a readable text log.
3. **Route visual artifacts to `antigravity_vision`.** Attach screenshots/PDFs
   and send a concise verdict prompt: "spot layout breaks, missing text,
   overflow, dark-mode mismatches" — not a full descriptive replay.
4. **Route textual artifacts to `antigravity_delegate`.** Send the structured
   text for pattern analysis: error clustering, deprecation warnings, failing
   network requests, accessibility violations.
5. **Integrate the verdicts.** The orchestrator reads both Gemini responses and
   acts on findings, escalating only concrete bugs to routine workers.
6. **No loops through Gemini.** If a finding needs a second look, collect a new
   targeted artifact and send a fresh call; do not conversationally
   back-and-forth with Gemini.

This pattern keeps the entire browser interaction in a single tool loop under
the primary agent, delegates only the inspection steps to Gemini, and produces
concise verdicts the orchestrator can act on immediately.

## Limitations

- **Prompt-only policy.** The orchestrator prompt describes the routing but the
  plugin does not intercept browser tool calls, enforce artifact splitting, or
  validate that Gemini was used for these tasks. This is a routing guideline,
  not an enforced guardrail.
- **No Playwright MCP integration.** The plugin does not provide a Playwright
  MCP server, manage browser binaries, or persist traces. The orchestrator uses
  whatever browser tools OpenCode makes available.
- **Antigravity must be installed separately.** The `antigravity_vision` and
  `antigravity_delegate` tools come from the `opencode-antigravity-delegate`
  plugin and the `agy` CLI. The routing instructions are inactive when that
  plugin is not present.
- **Binary traces are not directly routable.** Playwright's binary trace format
  is not supported by `antigravity_vision` or `antigravity_delegate`. The
  orchestrator must extract representative screenshots or a text log first.
- **Gemini Flash weakness at autonomy.** Gemini Flash is poor at long-horizon
  planning, so keep it to one-shot artifact analysis. Do not use it for
  multi-step UI verification logic; that stays on the primary orchestrator.
- **No claim that Gemini controls Playwright.** The prompts explicitly forbid
  the orchestrator from asserting Gemini has browser control. Gemini receives
  static artifacts only.
