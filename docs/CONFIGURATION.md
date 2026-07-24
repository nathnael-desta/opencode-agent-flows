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
`/flow-setup` command or `bun run setup`. If that file is missing, startup fails
with an error telling you to run setup — it does not silently fall back.

A generated config binds models, variants, billing sources, and budgets. It
**cannot** weaken prompts, tool permissions, step budgets, protected paths, or
escalation approval; those stay owned by the plugin's role templates.

## Complete Example

```jsonc
[
  "opencode-agent-flows@0.1.0",
  {
    "flow": "openai-commandcode-router",
    "setDefault": true,
    "telemetry": {
      "enabled": true,
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
      "refreshMs": 300000,
      "commandCodeMonthlyCreditsUsd": 40
    },
    "verification": {
      "enabled": true,
      "autoRun": false,
      "maxWorkerAttempts": 2,
      "timeoutMs": 300000
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
    "rift": {
      "enabled": false,
      "command": "rift",
      "runHooks": false,
      "retainWorkspaces": false
    },
    "guardrails": {
      "enabled": true,
      "protectedPaths": [
        ".env",
        "**/auth/**",
        "**/billing/**",
        "**/infrastructure/**",
        "**/migrations/**"
      ]
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
- Rift isolation is disabled until explicitly enabled on a supported filesystem.
- Automatic verification command execution is not implemented.
- Guardrails are enabled with conservative protected-path defaults.
- Medium and high escalation agents require permission approval.

## Rift Isolation

Set `rift.enabled` only after installing `rift-snapshot` and initializing the
repository on btrfs, a Linux filesystem with native reflinks, or APFS. The
plugin never initializes Rift automatically because `rift init` may convert a
btrfs directory into a subvolume. `flow_rift_init` always opens an explicit
permission prompt.

When enabled, the orchestrator uses:

- `flow_rift_begin` to snapshot the exact dirty session baseline.
- Concurrent `flow_rift_task` calls for independent writers.
- `flow_rift_integrate` for guarded central integration.
- `flow_rift_cleanup` to discard unintegrated snapshots.

Integration rejects undeclared worker changes, conflicting worker outputs, and
any live source file changed after the baseline. Post-create hooks are disabled
by default; set `runHooks` only for trusted project configuration. Windows is
not currently supported by Rift workspace creation.

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
| `cache/artificial-analysis.json` | Quality index cache (24h) |
| `runs/`, `sessions/`, `global.json` | Telemetry reports |
| `dashboard.html` | Self-contained dashboard |
