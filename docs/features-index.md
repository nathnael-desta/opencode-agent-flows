# Everything this plugin does

One page listing every capability, with where to read more.

## Choosing models

| Capability | What it gives you | More |
|---|---|---|
| Setup interview | `/flow-setup` picks a model per role from what you actually have | [Choose your models](orchestration-setup.md) |
| Effective cost | Ranks on what you *really* pay, not list price | [Effective cost](effective-cost.md) |
| Keyless discovery | models.dev pricing + AA coding index via OpenRouter, no API key | [Tools](tools.md#flow_discover_models) |
| Generated flows | `{ "flow": "custom" }` builds a flow from saved config | [Configuration](CONFIGURATION.md) |
| Config view/edit | `/flow-config`, `flow_configure`, dashboard panel | [Tools](tools.md) |
| Terminal + scripted setup | `bun run setup`, with flags for unattended runs | [Scripted setup](orchestration-setup.md#scripted-setup) |

## Running work

| Capability | What it gives you | More |
|---|---|---|
| Cheap-first routing | Roles from `bulk` to `deep`, escalating only on evidence | [Overview](README.md) |
| Hard budgets | Step, task, retry, concurrency and review limits | [Reliability](reliability.md) |
| Explicit task states | `blocked` / `failed` / `invalid-output` are never "success" | [Reliability](reliability.md#explicit-task-states) |
| Stable Task IDs | Rewording a retry cannot reset its attempt count | [Reliability](reliability.md#stable-task-ids) |
| Dependency frontiers | Bounded parallel dispatch, integrate, repeat | [Reliability](reliability.md#parallel-scheduling) |
| Escalation firewall | `deep` needs evidence *and* one-use approval | [Tools](tools.md#flow_approve_escalation) |
| Protected paths | Segment-aware guarding of sensitive directories | [Reliability](reliability.md#guardrails) |

## Quality gates

| Capability | What it gives you | More |
|---|---|---|
| Milestone review | A gate over a changeset, not a per-commit tax | [Milestone review](review.md) |
| Structured verdicts | `<flow-review>` JSON, max five evidence-backed findings | [Milestone review](review.md#reviewer-output) |
| Round limits | One round normally, two maximum, third always refused | [Milestone review](review.md#round-limits) |
| Reviewer isolation | Cannot edit, run shell, or delegate — enforced, not asked | [Milestone review](review.md#reviewer-isolation) |
| Developer experiments | Shadow planners and blind audit reviewers on a sample | [Telemetry](telemetry.md#feedback-and-experiments) |

## Isolation and reporting

| Capability | What it gives you | More |
|---|---|---|
| Rift isolation | Copy-on-write snapshots for safe parallel writers | [Rift](rift.md) |
| Guarded integration | Rejects undeclared, conflicting, and stale changes | [Rift](rift.md#integration-safeguards) |
| Run/session/global reports | Markdown plus a self-contained HTML dashboard | [Telemetry](telemetry.md) |
| Cost accounting | Subscription calls at $0, unpriced calls marked unpriced | [Telemetry](telemetry.md#cost-reporting) |
| Quota tracking | Codex rate limits and local credit budgets | [Telemetry](telemetry.md#quota) |

## Every tool and command

See [Tools and commands](tools.md) for all 15 `flow_*` tools and both
registered commands.
