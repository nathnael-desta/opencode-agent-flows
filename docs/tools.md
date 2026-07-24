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

**Sources.** Availability comes from OpenCode's own provider list, pricing and
capabilities from [models.dev](https://models.dev), and quality from
[Artificial Analysis](https://artificialanalysis.ai).

**Why it needs no API key.** Artificial Analysis's documented API requires an
account key even on its free tier. Rather than make you get one, quality is read
from their public models page, which embeds its charts as schema.org `Dataset`
blocks in `application/ld+json` — public, keyless, and marked
`isAccessibleForFree`.

**How it degrades.** Every source falls back rather than failing:

| Source | Live | Then | Finally |
|---|---|---|---|
| Pricing | models.dev | 24-hour cache | Provider-supplied pricing |
| Quality | Artificial Analysis page | 24-hour cache | Bundled snapshot |

So discovery always returns a usable catalog, even offline. The output states
which quality source was used, and carries the required attribution.

> [!NOTE]
> The public page lists roughly the top 20 models, so niche models may have no
> quality score. They still appear, marked `AA n/a`.

**Matching is exact, on purpose.** A model only receives a quality score when
its id or display name matches a published label exactly (after normalization).
Fuzzy matching was removed because every `-mini`, `-lite`, `-haiku`, `-air`, and
`-nano` derivative contains its flagship's name and would inherit the flagship's
score — making a cheap small model outrank the real frontier model and
inverting the very recommendation this exists to produce. A missing score is
safer than a wrong one.

**Models that cannot call tools are excluded from ranking.** Every role
delegates through tools, so a free embedding or text-to-speech model is
unusable regardless of price. Without this filter they would top the cost-led
ranking.

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

## Rift isolation

Only the root orchestrator may call these, and only when `rift.enabled` is set.

| Tool | Purpose |
|---|---|
| `flow_rift_status` | Whether Rift is available |
| `flow_rift_init` | Initialize (permission-gated; can alter workspace layout) |
| `flow_rift_begin` | Snapshot one immutable baseline of the dirty workspace |
| `flow_rift_task` | Run one worker in an isolated snapshot |
| `flow_rift_integrate` | Guarded central integration of completed workers |
| `flow_rift_cleanup` | Discard unintegrated snapshots |

See [Rift isolation](rift.md).
