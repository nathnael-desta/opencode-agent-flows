# General Orchestration Setup — Design

Status: proposed
Date: 2026-07-24

## Goal

Generalize `opencode-agent-flows` from a single hardcoded
`openai-commandcode-router` flow into a **general orchestration configurator**.
Instead of editing a TypeScript flow file, the user runs a setup skill that:

1. Discovers the OpenCode providers and models they actually have available.
2. Enriches each model with economics (models.dev pricing and capabilities)
   and, optionally, quality/cost-performance (Artificial Analysis indices).
3. Asks about the user's private *effective-cost* situation — subscription
   flat-rates and bundled credits that make an expensive model cheap in
   practice (e.g. Gemini Flash via Google AI Pro / Antigravity credits).
4. Recommends a model for each orchestration role and lets the user choose.
5. Persists the result as a data-driven flow the plugin loads, plus an easy
   surface to view and edit it later.

The stable orchestration *skeleton* (orchestrator, bulk, routine, reviewer,
deep/escalation) does not change — only the binding of each role to a concrete
`provider/model/variant/effort` and its billing/economics metadata.

## Grounding (verified)

- **OpenCode available models**: the plugin `input.client` is an
  `createOpencodeClient` instance. `client.config.providers()`
  (`GET /config/providers`) returns
  `{ providers: Provider[], default: Record<string,string> }`, where each
  provider is `{ id, name, env, npm, api, models: { [id]: { id, name,
  release_date, reasoning, tool_call, cost, limit, modalities, ... } } }`.
  This is the set of models the user can actually route to *right now*.
- **models.dev**: `https://models.dev/api.json` is the canonical catalog.
  Shape: `{ [providerId]: { id, name, env, npm, api, doc, models: { [modelId]:
  { id, name, family, reasoning, tool_call, release_date, open_weights,
  modalities, limit: { context, output }, cost: { input, output, cache_read,
  cache_write } } } } }`. Costs are USD per **1M tokens**. OpenCode already
  merges this data, so IDs align.
- **Artificial Analysis**: has a free Data API
  (`https://artificialanalysis.ai/data-api`) but **requires a user API key**
  (create an account, generate a key). Free tier returns headline indices
  (Intelligence, Coding, Agentic), median performance, and input/output
  pricing; attribution to artificialanalysis.ai is required. Because it needs a
  key, it is **optional/best-effort** — the base experience must work with
  models.dev alone.

## Core concept: effective cost

Paper price (models.dev `cost`) is not the number the user optimizes against.
Each model carries a **billing source** that transforms its effective cost:

| Billing source        | Effective cost model                                    | Example |
|-----------------------|---------------------------------------------------------|---------|
| `metered`             | paper price per token                                    | raw OpenAI/Anthropic API key |
| `subscription-flat`   | ~$0 marginal within plan capacity (capacity-limited)     | ChatGPT Plus/Pro through `openai` |
| `credit-pool`         | paper price drawn against a fixed monthly credit balance | Command Code $40/mo |
| `bundled-credit`      | discounted/free via a bundle the user already paid for   | Gemini Flash via Google AI Pro / Antigravity |

The setup interview captures which source applies to each provider/model and any
multiplier or override, then **recommendations rank on effective cost × quality,
not paper price**. This is the feature that makes a "paper-expensive" model the
right cheap default when the user has bundled credits for it.

## Architecture

### 1. Data-driven flow (`orchestration-config.json`)

A persisted JSON document in the telemetry/state dir
(`~/.local/state/opencode-agent-flows/orchestration-config.json`), mirroring the
existing `model-overrides.json` pattern. When present and selected
(`{ "flow": "custom" }`, or auto-detected), the plugin builds a
`FlowDefinition` from it at startup instead of requiring a TS flow file.

Sketch:

```jsonc
{
  "version": 1,
  "title": "My orchestration",
  "roles": {
    "orchestrator": { "model": "openai/gpt-5.6-sol", "variant": "low",
                      "billingSource": "subscription-flat", "effectiveCostNote": "ChatGPT Plus" },
    "bulk":    { "model": "google/gemini-flash", "billingSource": "bundled-credit",
                 "effectiveCostNote": "Antigravity credits — treat as ~free" },
    "routine": { "model": "commandcode/deepseek-v4-pro", "variant": "high", "billingSource": "credit-pool" },
    "reviewer":{ "model": "commandcode/mimo-v2.5-pro", "billingSource": "credit-pool" },
    "deep":    { "model": "openai/gpt-5.6-terra", "variant": "high", "billingSource": "subscription-flat" }
  },
  "orchestration": { "maxTasksPerRun": 12, "maxConcurrentWorkers": 3 },
  "reviewer": { "enabled": true, "maxRounds": 2, "maxFindings": 5 }
}
```

The role → agent skeleton, prompts, permissions, and safety limits stay owned by
the plugin (a `roleTemplate` map), so a generated config can only rebind
model/variant/billing and tune budgets — it cannot weaken guardrails.

### 2. Discovery layer (new read-only tools)

- `flow_discover_models`: calls `client.config.providers()`, cross-references
  models.dev `api.json` (fetched once, cached to state dir with a TTL), and —
  only if an Artificial Analysis key is configured — overlays AA indices.
  Returns a normalized catalog: `{ provider, model, costIn, costOut, context,
  reasoning, toolCall, intelligenceIndex?, codingIndex? }`. Degrades cleanly
  offline (uses cache) and without an AA key (omits indices).

### 3. Setup skill (interview)

An OpenCode skill (`SKILL.md`) + command that the orchestrator runs. It:

1. Calls `flow_discover_models`.
2. For each role, ranks candidates by effective cost × quality and shows the
   top options.
3. Asks the **special-info questions** (subscription flat-rates, bundled
   credits, monthly credit pools, rate limits, provider/family preferences,
   risk tolerance) and records the billing source per provider.
4. Proposes a role → model assignment with a one-line rationale each.
5. Lets the user confirm or override every role.
6. Writes `orchestration-config.json` via a new `flow_configure` tool.

### 4. View / edit surface

- `flow_config` tool: prints the current effective orchestration config —
  each role's model, effective cost, billing source, and why it was chosen.
- Extend the generated dashboard (`dashboard.html`) with a config panel, or emit
  a dedicated `orchestration.html`, so the config is browsable outside the TUI.
- Editing stays incremental: `flow_configure` (whole config) and the existing
  `flow_models` (single-role model override).

## Phased plan

- **Phase A — data-driven flow loader.** `orchestration-config.json` schema +
  role templates + plugin loads a generated flow. Pure, no network. Tests.
- **Phase B — discovery tools.** `flow_discover_models` over
  `client.config.providers()` + models.dev (cached); AA optional. Fixture tests.
- **Phase C — setup skill.** `SKILL.md` + command: interview, effective-cost
  ranking, recommendations, writes config via `flow_configure`.
- **Phase D — view/edit surface.** `flow_config` tool + dashboard config panel.
- **Phase E — docs.** Folds into the Docsify documentation task.

## Open decisions

1. **Skill delivery**: an in-OpenCode skill/command the orchestrator runs
   interactively (recommended — matches "run the skill in an agent"), versus a
   standalone `bun` CLI setup script run outside OpenCode.
2. **Artificial Analysis**: keep optional (only when the user supplies an AA
   key), with models.dev as the always-available base (recommended).
3. **UI depth**: a generated HTML config panel in the existing dashboard
   (recommended) versus tool-printed text only for now.

## Non-goals / boundaries

- The setup skill never edits `opencode.json` provider/auth blocks or runs
  `/connect`; adding a provider or credentials stays a manual OpenCode step.
- Generated configs cannot weaken protected-path guardrails, escalation
  approval, or reviewer/worker loop limits — those remain plugin-owned.
- Effective cost for subscription/bundle sources is an estimate; capacity and
  bundle limits are not token-metered.
