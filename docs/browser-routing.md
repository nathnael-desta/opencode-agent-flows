# Browser Control and Antigravity UI Workflow

The orchestrator uses Browser Control MCP for browser interaction and Gemini
through Antigravity for selected visual analysis. This separation keeps user
intent, authenticated state, actions, and safety decisions on the primary
orchestrator while moving expensive image inspection to bundled Gemini quota.

Neither integration is a hard dependency. This plugin supplies routing policy;
it does not install Browser Control or Antigravity and does not intercept their
tools.

## Responsibility split

| Responsibility | Owner |
|---|---|
| Navigate, click, type, wait, and inspect the live page | Root orchestrator through Browser Control MCP |
| Preserve authenticated/user browser state | One named or adopted Browser Control session |
| CAPTCHA, 2FA, passkeys, and payment confirmation | Human through Browser Control `handoff()` |
| DOM, ARIA, computed-style, and bounding-box verification | Root orchestrator |
| Analyze selected screenshots, rendered PDFs, and diagrams | `antigravity_vision` |
| Decide whether a visual finding is real and worth fixing | Root orchestrator |

Gemini never controls the browser. It receives static files plus a bounded
description of intent and returns advisory evidence. The orchestrator validates
actionable findings against the live page before changing code.

## Token-efficient browser loop

1. **Keep one session.** Reuse a named Browser Control session for the task, or
   adopt the user's attached tab when login, extensions, or reproduced state
   matter.
2. **Inspect once, narrowly.** Begin with `snapshot()` bounded to the relevant
   region and a sensible item limit. Avoid raw HTML and a full accessibility
   tree unless a compact snapshot omits required structure.
3. **Batch dependent interaction.** Put transient steps—open a menu, choose an
   item, wait, and assert the result—in one `browser-control_execute` call.
4. **Return evidence, not a replay.** Return only acceptance-specific fields such
   as URL, selected state, visible text, overflow status, bounding boxes, and
   console/page error counts.
5. **Diff only compatible state.** Use `snapshot({ diff: true })` for a tab,
   dropdown, dialog, or other same-page update. Navigation and reload invalidate
   the useful baseline and normally require a fresh bounded snapshot.
6. **Use visual checkpoints sparingly.** Capture the initial bug, a materially
   changed visual state, an ambiguous DOM-versus-rendered result, and final
   confirmation—not every edit cycle.
7. **Validate visual findings.** Check Gemini claims with DOM/ARIA/computed
   styles/bounding boxes. Theme, viewport, scroll position, cursors, and Browser
   Control overlays are capture differences until evidence proves otherwise.

### Focused browser result

Prefer a result like this over another page dump:

```json
{
  "url": "http://localhost:3000/settings",
  "headingVisible": true,
  "saveButtonEnabled": true,
  "horizontalOverflow": false,
  "consoleErrors": 0
}
```

## Fifteen-cycle localhost workflow

For a long UI fix, keep the browser session alive while code changes arrive
through HMR or a page reload:

1. Record a compact UI intent/state summary: user goal, route, viewport, theme,
   visual invariants, stable selectors, and known defects.
2. Capture one initial bounded snapshot and screenshot.
3. Make a coherent code change outside the browser loop.
4. In the existing session, wait for HMR or reload completion and for the target
   element to become stable.
5. Return focused DOM and error evidence. Do not return the whole page.
6. If the same page changed unexpectedly, request a semantic diff. If navigation
   or reload invalidated refs, request a new bounded snapshot.
7. Capture a screenshot only when the visual result materially changed, DOM
   evidence cannot answer the question, or final verification is due.
8. Send the screenshot and compact state summary to Antigravity Vision.
9. Disposition at most three visual findings, verify real ones against the page,
   and update the state summary.
10. Repeat from step 3 until acceptance is met, then take one final checkpoint.

This keeps most iterations to a small action script plus structured assertions.
The expensive pixels are read by Gemini only at meaningful checkpoints.

## Visual analysis packet

Do not send an unexplained screenshot. Use this compact template:

```text
Page: <route and page purpose>
Viewport/theme: <width>x<height>, <theme>
User goal: <the behavior being fixed>
Expected visual invariants:
- <at most a few observable requirements>
Actions performed: <bounded summary>
Focused DOM evidence: <selected state, text, overflow, bounds, errors>
Changed since prior checkpoint: <specific visual/code change>
Questions: <exact visual questions>
Ignore as capture differences: <cursor, BC · RUN overlay, theme/viewport/scroll differences>

Return a concise verdict and confidence. Report at most three evidence-backed
findings. Distinguish genuine defects from capture or environment differences.
Do not suggest browser actions.
```

Save screenshots to temporary absolute paths. When a tiered Gemini model such
as `gemini-3.6-flash-high` is selected, do not also pass an effort argument—the
model name already encodes it.

## Authenticated and consequential flows

- Prefer adopting the exact user-attached tab rather than recreating login.
- Use Browser Control `handoff()` for CAPTCHA, 2FA, passkeys, payment
  confirmation, or another human-only step.
- Human acknowledgement is not proof: verify the expected URL or stable element
  afterward.
- Require explicit user confirmation before destructive or account-changing
  actions, and verify the result independently.
- Never send credentials, cookies, raw authenticated HTML, or captured network
  secrets to Antigravity.

## Failure behavior

If Browser Control is disconnected, use its status and doctor diagnostics and
ask the user to attach or reconnect. Do not silently switch to an isolated
browser when personal state is part of the task.

If Antigravity is unavailable, continue with Browser Control's semantic, DOM,
and computed-style checks and disclose that visual offload was unavailable.

## Why this design

Browser actions are cheap in tokens; observations are expensive. Repeated full
snapshots, screenshots in primary-model context, raw HTML, traces, and logs
dominate browser-loop cost. Browser Control provides persistent real-browser
state, focused Playwright execution, and same-page diffs. Antigravity Vision
absorbs selected image payloads. A compact intent/state packet prevents the
visual worker from losing the reason behind the screenshot.

The root orchestrator remains the integration point because visual models can
confuse viewport, theme, scroll position, or automation overlays with defects.
DOM verification turns those suggestions into evidence before code is changed.

## Limitations

- Routing is prompt policy, not tool interception.
- Browser Control and Antigravity must be installed independently.
- Semantic diffs do not save tokens across incompatible navigation or reload.
- Browser Control uses the user's real profile and must be treated as trusted,
  authenticated access—not a security sandbox.
- Gemini Flash is a one-shot perception helper, not a long-horizon browser
  agent, implementation worker, escalation agent, or review gate.

## Measured against playwright-cli

Same operations, measured directly:

| Operation | playwright-cli | Browser Control | Browser Control + filtered JSON |
|---|---|---|---|
| Trivial eval | 124 B | 3 B | 3 B |
| Navigate | 419 B | 642 B | **39 B** |

Browser Control wins clearly — **but only with JSON output that you filter**.
Plain output emits every console and network event, so one noisy page (a failing
GSI script, a WebSocket retry loop) can flood a single call. playwright-cli
additionally echoes the whole script back in a "Ran Playwright code" block on
every run and writes snapshot files you then pay to read.

Operationally Browser Control is also the better driver: real Playwright
locators (`getByRole`, `fill`, `waitForSelector`) let the orchestrator assert
instead of sleeping and re-polling — that is what caught an "editor never
mounted" case immediately rather than passing silently. Sessions persist across
calls, so an authenticated tab is not re-logged-in each time.

Two gotchas the prompt now states explicitly:

- Code executes **Node-side**. Anything touching the document must run inside
  `page.evaluate`.
- It can **adopt your real authenticated tab**, which is desirable for logged-in
  work but means destructive actions need explicit confirmation.
