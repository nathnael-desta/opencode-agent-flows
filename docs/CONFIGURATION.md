# Configuration

## Choosing A Flow

The `flow` option selects which orchestration to run:

| Value | Meaning |
|---|---|
| `openai-commandcode-router` | The built-in flow (default) |
| `custom` | Your generated configuration — see [Choose your models](orchestration-setup.md) |

```json
["opencode-agent-flows", { "flow": "custom", "setDefault": true }]
```

With `"custom"`, the plugin loads
`~/.local/state/opencode-agent-flows/orchestration-config.json`, written by the
`/flow-setup` command or `bun run setup`.

If that file is missing or invalid, the plugin **degrades to the built-in flow**
and reports why through `flow_config`. It deliberately does not fail startup:
refusing to load would unregister every tool, including the `flow_configure`
you need to repair the configuration.

A generated config binds models, variants, billing sources, and budgets. It
**cannot** weaken prompts, tool permissions, per-agent step budgets, protected
paths, or escalation approval; those stay owned by the plugin's role templates.
Flow-level budgets are **clamped** to sane ranges on load
(`maxTasksPerRun` 1–50, `maxConcurrentWorkers` 1–8, `maxRounds` 1–3,
`maxFindings` 1–20, `maxPacketChars` 1,000–50,000, `sampleRate` 0–1), so a
configuration cannot remove the concurrency limit or silently disable review.

## Complete Example

```jsonc
[
  "opencode-agent-flows@0.2.0",
  {
    "flow": "openai-commandcode-router",
    "setDefault": true,
    "telemetry": {
      "reportDir": "~/.local/state/opencode-agent-flows",
      "runSummaryToast": true,
      "dashboard": true,
      "retentionDays": 90,
      "displacementEfficiency": 0.75,
      "apiEquivalentPricing": {
        "openai/gpt-5.6-sol": { "input": 5, "output": 30, "cacheRead": 0.5, "cacheWrite": 6.25 },
        "openai/gpt-5.6-terra": { "input": 2.5, "output": 15, "cacheRead": 0.25, "cacheWrite": 3.125 }
      }
    },
    "quota": {
      "codex": true,
      "commandCodeMonthlyCreditsUsd": 40
    },
    "verification": {
      "maxWorkerAttempts": 2
    },
    "orchestration": {
      "maxTasksPerRun": 12,
      "maxConcurrentWorkers": 3
    },
    "reviewer": {
      "enabled": true,
      "agent": "reviewer",
      "sampleRate": 0.1,
      "maxRounds": 2,
      "maxFindings": 5,
      "maxPacketChars": 12000
    },
    "guardrails": {
      "enabled": true,
      "protectedPaths": [
        ".env",
        "**/auth/**",
        "**/billing/**",
        "**/infrastructure/**",
        "**/migrations/**"
      ],
      "approvalAgents": ["deploy"]
    },
    "developer": {
      "enabled": false,
      "auditReview": false,
      "shadowPlanning": false,
      "shadowImplementation": false,
      "sampleRate": 0.1,
      "sampleSalt": "experiment-1"
    }
  }
]
```

## Safe Defaults

- Telemetry and run-summary toast are enabled.
- Dashboard generation is enabled when reports are written.
- Codex quota lookup is disabled until explicitly requested.
- Command Code budget is unavailable until an allowance is configured.
- Developer evaluation mode is disabled.
- Dynamic verification guidance is enabled.
- Runs are capped at 12 delegated tasks and 3 concurrent workers.
- Reviewer output is capped at 5 findings and 2 milestone rounds.
- Automatic verification command execution is not implemented.
- Guardrails are enabled with conservative protected-path defaults.
- Medium and high escalation agents require permission approval.

## Developer Experiments

Developer mode can now be changed during an OpenCode session with
`flow_developer_mode`; it persists at
`~/.local/state/opencode-agent-flows/developer-mode.json`. This avoids editing
or restarting for normal enable/disable and sampling changes. All evaluator
agents are registered at startup but remain inactive until the mode is enabled.

Each evaluator can be selected independently:

```json
{
  "developer": {
    "enabled": true,
    "auditReview": true,
    "shadowPlanning": true,
    "shadowImplementation": false,
    "sampleRate": 0.25,
    "sampleSalt": "router-evaluation-july"
  }
}
```

The sample rate applies to enabled developer evaluations. Production reviewer
sampling is configured separately under `reviewer.sampleRate`.

`sampleSalt` makes deterministic sampling reproducible. The same flow, run ID,
salt, and rate select the same runs after restart; change the salt when starting
a new experiment cohort.

## Compatibility Placeholders

The TypeScript option types still accept several fields from earlier prototypes,
but they do not currently alter runtime behavior:

| Option | Current behavior |
|---|---|
| `telemetry.enabled` | Reserved. Telemetry remains active; control output with `reportDir`, `dashboard`, and `runSummaryToast`. |
| `verification.enabled` | Reserved. Repository-aware verification guidance remains part of the flow. |
| `verification.autoRun` | Reserved; deterministic automatic command execution is not implemented. |
| `verification.timeoutMs` | Reserved; OpenCode's built-in task tool does not expose a general wall-clock cancellation hook here. |
| `quota.refreshMs` | Reserved; quota is sampled when a run report is finalized. |

They are intentionally omitted from the complete example so the example does
not imply functionality that does not exist.

## Additional Approval Agents

`guardrails.approvalAgents` adds agent names to the plugin's one-use approval
firewall. This is useful for a locally defined deployment or production agent
that should require `flow_approve_escalation` even when the selected flow does
not mark it as an escalation role. It can only add gates; it cannot remove the
approval requirement from `deep` or `extreme-*`.

## API-equivalent prices

`telemetry.apiEquivalentPricing` is optional and maps `provider/model` to USD
prices per **one million tokens**. It is used only for comparison reporting;
subscription-backed calls remain metered at `$0` and are never presented as a
billed API charge. The dashboard explicitly marks calls without a configured
price as unpriced rather than treating them as free. The included Sol and Terra
rate cards are local comparison defaults: review them whenever the provider's
published price card changes.

## Deprecated Flat Options

The initial local telemetry prototype accepted `usageTracking`,
`usageReportDir`, `usageToast`, and `displacementEfficiency` at the top level.
They still work temporarily, but new configurations should use `telemetry`.

## Generated Orchestration Config

Written by `/flow-setup` or `bun run setup` to
`~/.local/state/opencode-agent-flows/orchestration-config.json`:

```json
{
  "version": 1,
  "title": "My orchestration",
  "roles": {
    "orchestrator": { "model": "openai/gpt-5.6-sol", "variant": "low", "billingSource": "subscription-flat", "effectiveCostNote": "ChatGPT Plus" },
    "routine": { "model": "commandcode/deepseek-v4-pro", "variant": "high", "billingSource": "credit-pool" },
    "bulk": { "model": "google/gemini-3.6-flash", "billingSource": "bundled-credit", "effectiveCostNote": "Antigravity credits" }
  },
  "orchestration": { "maxTasksPerRun": 12, "maxConcurrentWorkers": 3 },
  "reviewer": { "enabled": true, "maxRounds": 2, "maxFindings": 5 }
}
```

Only `orchestrator` and `routine` are required. `bulk` and `reviewer` inherit
`routine`; `deep` and `extreme-*` inherit `orchestrator`.

`billingSource` is one of `metered`, `subscription-flat`, `credit-pool`,
`bundled-credit`, or `unknown`. It determines effective cost — see
[Effective cost](effective-cost.md).

Edit it without redoing the interview:

```text
flow_configure role=reviewer model=commandcode/mimo-v2.5-pro billingSource=credit-pool
flow_configure maxConcurrentWorkers=5
flow_configure reset=true
```

## Registered Commands

The plugin registers `/flow-setup` and `/flow-config` through the OpenCode
config hook, so no skill file needs installing. It never overwrites a command
you defined yourself.

## Local State

Everything persistent lives under the telemetry report directory
(`telemetry.reportDir`, default `~/.local/state/opencode-agent-flows`):

| File | Purpose |
|---|---|
| `orchestration-config.json` | Your generated flow |
| `model-overrides.json` | Per-agent model overrides from `flow_models` |
| `developer-mode.json` | Developer evaluation settings |
| `cache/models-dev.json` | models.dev pricing cache (24h) |
| `cache/model-quality.json` | Quality index cache (24h) |
| `runs/`, `sessions/`, `global.json` | Telemetry reports |
| `dashboard.html` | Self-contained dashboard |
