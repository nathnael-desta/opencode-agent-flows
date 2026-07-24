# Tools and commands

Everything the plugin exposes inside an OpenCode session.

## Commands

The plugin registers these itself, so there is no skill file to install. It
never overwrites a command you defined yourself.

| Command | Purpose |
|---|---|
| `/flow-setup` | Run the model-selection interview and save a configuration |
| `/flow-config` | Show the saved orchestration configuration |

## Setup and configuration

### `flow_discover_models`

Lists the provider models OpenCode can reach, enriched and ranked per role.

```text
flow_discover_models                      # all roles
flow_discover_models role=bulk            # one role
flow_discover_models refresh=true         # bypass the 24-hour cache
```

**Sources.** Three signals, all keyless:

| Signal | Source |
|---|---|
| Which models you can actually reach | OpenCode's own provider list |
| Price, context, capabilities | [models.dev](https://models.dev) |
| Quality indices | [Artificial Analysis](https://artificialanalysis.ai), via OpenRouter |

**Why it needs no API key.** Artificial Analysis's own API requires an account
key even on its free tier, and we will not ask you for one. OpenRouter
republishes the same AA indices in its public models endpoint, so the data
arrives as plain JSON with no key, no signup, and no scraping.

**Why quality is coding-specific.** That endpoint carries an
`artificial_analysis.coding_index` alongside the general intelligence index.
Since every role here writes code, discovery ranks on the coding index and
records which index a score came from — the two are not comparable, so they are
never mixed silently.

**How it degrades.** Every source falls back rather than failing:

| Source | Live | Then | Finally |
|---|---|---|---|
| Pricing | models.dev | 24-hour cache | Provider-supplied pricing |
| Quality | OpenRouter | 24-hour cache | Bundled 116-model snapshot |

Discovery always returns a usable catalog, even offline. The output states which
quality source was used and carries the attribution.

> [!NOTE]
> Roughly 160 models resolve a quality score. Models without one still appear,
> marked `quality n/a`, and rank on cost alone.

**Matching is exact, on purpose.** A score is applied only when the model id
matches exactly, after a total normalization that lowercases and unifies `.`
with `-` (OpenRouter writes `claude-opus-4.8` where models.dev writes
`claude-opus-4-8`). Models routed as `openrouter/<id>` resolve to the upstream
id.

Substring matching is deliberately forbidden: every `-mini`, `-lite`, `-haiku`,
`-air`, and `-nano` derivative contains its flagship's name and would inherit
the flagship's score, making a cheap small model outrank the real frontier model
and inverting the recommendation this exists to produce. A missing score is
safer than a wrong one.

**Ids resolve across aggregators and resellers.** A score is found by trying the
full id, then the vendor-qualified remainder (`github-models/microsoft/phi-4`
resolves `microsoft/phi-4`), then the bare model name **only where it is
unambiguous** (`commandcode/deepseek-v4-pro` resolves `deepseek/deepseek-v4-pro`).
Ambiguous names are refused rather than guessed. Every step is exact string
equality. On a real aggregator-heavy setup this took coverage from 13 of 306
models to 127.

**Models that cannot call tools are excluded from ranking.** Every role
delegates through tools, so a free embedding or text-to-speech model is unusable
regardless of price. Without this filter they topped the cost-led ranking.

### `flow_config`

Shows each role's model, billing source, effective cost, rationale, which roles
inherit their binding, current budgets, and whether the configuration is
actually active.

### `flow_configure`

Writes the configuration. Restart OpenCode to apply.

```text
flow_configure roles={"orchestrator":{...},"routine":{...}}   # set everything
flow_configure role=reviewer model=commandcode/mimo-v2.5-pro  # one role
flow_configure maxConcurrentWorkers=5                          # budgets
flow_configure reviewerEnabled=false                           # review policy
flow_configure reset=true                                      # remove it
```

Validation rejects unknown roles, malformed `provider/model` values, unknown
billing sources, and any configuration missing `orchestrator` or `routine` —
rather than saving something half-formed.

### `flow_models`

Overrides a single agent's model without touching the orchestration config.
Useful for a quick experiment.

```text
flow_models                                            # show current mapping
flow_models agent=routine model=commandcode/laguna-s-2.1-free
flow_models agent=routine reset=true
```

### `flow_antigravity`

Detects whether Google Antigravity (Gemini on a Google AI Pro subscription, via
the `agy` CLI) is available, and prints how to route work to it. Gemini is an
effectively-free helper for **vision** (screenshots, UI, PDFs, diagrams —
stronger than frontier coding models), **large-context reads** (1M window), and
**cheap bulk work**. Keep the agentic loop and review on your primary models;
Flash is weak at long-horizon autonomy.

The tools themselves ship in the separate `opencode-antigravity-delegate` plugin
(`antigravity_vision` / `antigravity_delegate` / `antigravity_background_*`);
when both plugins are loaded the orchestrator delegates to them automatically.

## Telemetry

| Tool | Purpose |
|---|---|
| `flow_status` | Markdown report for `run`, `session`, or `global` scope |
| `flow_dashboard` | Path to the self-contained HTML dashboard |
| `flow_feedback` | Record `good` / `mixed` / `bad` feedback on the last run |
| `flow_developer_mode` | Toggle evaluator experiments without editing config |

See [Telemetry and reports](telemetry.md).

## Escalation

### `flow_approve_escalation`

Escalation to `deep` or `extreme-*` is blocked until you approve it. Approval is
**one use** — it is consumed by a single delegation and cannot be reused.

`deep` additionally requires that the run already contains a concrete failed or
blocked `routine` result. Being long or touching many files is not evidence.

