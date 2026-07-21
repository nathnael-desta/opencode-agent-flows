# Configuration

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
    "reviewer": {
      "enabled": true,
      "agent": "reviewer",
      "sampleRate": 0.1
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
