# Choose your models

Instead of hardcoding models in a flow file, you can generate a flow from the
models **you actually have**, ranked by what they really cost you and how good
they are.

## The fastest path

Inside an OpenCode session, run:

```text
/flow-setup
```

The orchestrator interviews you and writes the result. Then set the custom flow
in `opencode.json` and restart OpenCode:

```json
{
  "plugin": [
    ["opencode-agent-flows", { "flow": "custom", "setDefault": true }]
  ]
}
```

Check it any time with `/flow-config`.

## What the interview does

1. **Discovers your models.** It calls `flow_discover_models`, which asks
   OpenCode which providers you have authenticated, then enriches each model
   with [models.dev](https://models.dev) pricing and capabilities and
   [Artificial Analysis](https://artificialanalysis.ai) coding scores (fetched
   keyless via OpenRouter — you never need an API key).

2. **Asks how each provider is billed.** This is the important part, because
   paper price is rarely your real cost. See [Effective cost](effective-cost.md).

3. **Asks what pricing data cannot show.** Capacity or rate limits you keep
   hitting, families you want to prefer or avoid, whether a plan is nearly
   exhausted, and whether you want to hold a premium plan in reserve.

4. **Re-ranks and proposes** one model per role, each with a one-line rationale
   naming its quality index and effective cost. When a paper-expensive model
   becomes the right cheap default, it says so explicitly.

5. **Confirms before saving.** Nothing is persisted until you approve, then it
   writes the config via `flow_configure`.

## Roles you can set

Only `orchestrator` and `routine` are required. Anything you omit inherits:

| Role | Inherits from when omitted |
|---|---|
| `orchestrator` | — (required) |
| `routine` | — (required) |
| `bulk` | `routine` |
| `reviewer` | `routine` |
| `deep` | `orchestrator` |
| `extreme-medium`, `extreme-high` | `orchestrator` |

> [!TIP]
> Give `reviewer` a different model **family** from `routine`. A reviewer that
> shares the implementer's blind spots is not an independent review.

## The saved configuration

The interview writes
`~/.local/state/opencode-agent-flows/orchestration-config.json`:

```json
{
  "version": 1,
  "title": "My orchestration",
  "roles": {
    "orchestrator": {
      "model": "openai/gpt-5.6-sol",
      "variant": "low",
      "billingSource": "subscription-flat",
      "effectiveCostNote": "ChatGPT Plus"
    },
    "routine": {
      "model": "commandcode/deepseek-v4-pro",
      "variant": "high",
      "billingSource": "credit-pool"
    },
    "bulk": {
      "model": "google/gemini-3.6-flash",
      "billingSource": "bundled-credit",
      "effectiveCostNote": "Antigravity credits via Google AI Pro"
    }
  },
  "orchestration": { "maxTasksPerRun": 12, "maxConcurrentWorkers": 3 },
  "reviewer": { "enabled": true, "maxRounds": 2, "maxFindings": 5 }
}
```

### What a config can and cannot change

A generated config binds **models, variants, billing, and budgets**. It can
**never** weaken safety. Prompts, tool permissions, step budgets, protected
paths, and escalation approval are owned by the plugin's role templates.

That means you cannot accidentally configure a reviewer that can edit files, or
an escalation tier that skips approval.

## Editing later

```text
/flow-config                                    # view current configuration
```

Change one role without redoing the interview:

```text
flow_configure role=reviewer model=commandcode/mimo-v2.5-pro billingSource=credit-pool
```

Tune budgets, or start over:

```text
flow_configure maxConcurrentWorkers=5
flow_configure reset=true
```

Your configuration also appears as a panel in the
[HTML dashboard](telemetry.md).

## Terminal setup

If you prefer a terminal, or want to configure without a session open:

```bash
bun run setup
```

Point it at a running OpenCode server for the accurate provider list:

```bash
bun run setup --server http://127.0.0.1:4096
```

Without a server it falls back to the providers in your `opencode.json`, and
failing that the full models.dev catalog — which lists providers you may not be
able to reach, so it warns you. The in-OpenCode `/flow-setup` command is the
more accurate path because it sees your live, authenticated provider list.

### Scripted setup

Pass roles as flags to skip the interview entirely — useful for dotfiles, a new
machine, or CI:

```bash
bun run setup \
  --orchestrator openai/gpt-5.6-sol \
  --routine commandcode/deepseek-v4-pro \
  --bulk google/gemini-3.6-flash \
  --billing openai=subscription-flat \
  --billing google=bundled-credit \
  --note google="Antigravity credits via Google AI Pro" \
  --title "My orchestration" --yes
```

`bun run setup --help` lists every flag.

## Troubleshooting

**"Your configuration could not be loaded."** You selected `"flow": "custom"`
without a valid config. The plugin falls back to the built-in flow and keeps all
its tools, so you can fix it in place with `/flow-setup` or `flow_configure`.

**Changes did not take effect.** Model bindings are applied when OpenCode
starts. Restart it.

**Discovery returned no models.** OpenCode has no authenticated providers.
Add one with `/connect` first.

See [Troubleshooting](troubleshooting.md) for more.
