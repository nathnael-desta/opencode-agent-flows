# OpenCode Agent Flows

Version-controlled, shareable agentic orchestration for OpenCode. Provider
adapters stay in their own repositories; this project decides **which agent uses
which provider, model, and reasoning effort** — and does the delegation,
review, and budgeting around that choice.

## What problem it solves

Running every request through one expensive frontier model is wasteful; running
everything through one cheap model is unreliable. This plugin routes work across
a **cheap-first ladder of roles**, escalating only on evidence:

| Role | Does what | Wants |
|---|---|---|
| `orchestrator` | Classifies and delegates every turn | Strong reasoning, low effective cost |
| `bulk` | Repetitive, low-risk, token-heavy work | The cheapest capable model |
| `routine` | The default worker for bounded implementation | Balance |
| `reviewer` | Independent milestone review | A different model family from `routine` |
| `deep` | Escalation after `routine` fails or blocks | The strongest model |
| `extreme-*` | Exceptional approval-gated tiers | The strongest model, higher effort |

## Two ways to use it

**1. A built-in flow.** Ship-ready and opinionated — see
[OpenAI + Command Code router](flows/openai-commandcode-router.md).

```json
["opencode-agent-flows", { "flow": "openai-commandcode-router", "setDefault": true }]
```

**2. Your own, generated from what you actually have.** Run the `flow-setup`
command inside OpenCode. It discovers your providers, prices them, ranks them by
quality, asks how each is billed, and writes a configuration.

```json
["opencode-agent-flows", { "flow": "custom", "setDefault": true }]
```

See [Choose your models](orchestration-setup.md).

## The core idea: effective cost

A model's paper price is usually **not** what you pay at the margin. A model that
looks expensive can be the correct cheap default when a subscription or a prepaid
bundle already covers it.

> Gemini Flash bundled with a Google AI Pro plan is effectively free for you,
> even though its list price is not zero. The setup interview captures exactly
> this, and re-ranks every recommendation around it.

Read [Effective cost](effective-cost.md).

## What you get

- **Cheap-first routing** with structurally enforced, approval-gated escalation.
- **Keyless model discovery** — [models.dev](https://models.dev) pricing and
  [Artificial Analysis](https://artificialanalysis.ai) quality, with no API key
  and graceful offline degradation.
- **Milestone review** as a gate, not a per-commit tax.
- **Hard budgets**: task, concurrency, retry, review, and agent-step limits.
- **Telemetry**: run/session/global reports plus an HTML dashboard.

## Quick start

```bash
git clone https://github.com/nathnael-desta/opencode-agent-flows.git
cd opencode-agent-flows
bun install
bun run verify
```

Then follow [Install and configure](CONFIGURATION.md).

## Running these docs

```bash
bun run docs:serve   # then open http://localhost:3000
```
