# Telemetry and reports

The plugin records what every run actually did — which models ran, what they
cost, what was verified, and what failed.

## Scopes

| Scope | Meaning |
|---|---|
| **Run** | One root user turn |
| **Session** | The whole OpenCode conversation tree |
| **Global** | Every persisted run |

## Outputs

```text
~/.local/state/opencode-agent-flows/latest-run.md
~/.local/state/opencode-agent-flows/latest-session.md
~/.local/state/opencode-agent-flows/global.md
~/.local/state/opencode-agent-flows/dashboard.html
```

Read them from any client with `flow_status`, or get the dashboard path with
`flow_dashboard`. The dashboard is a self-contained HTML file, so it works from
T3 Code, the TUI, desktop clients, and a plain browser.

It includes a panel showing your current
[orchestration configuration](orchestration-setup.md): each role's model,
billing source, effective cost, and rationale.

## What a report contains

Models and providers, billing sources, subagent counts, task outcomes,
verification evidence, quality evidence, structured review verdicts and
findings, quota snapshots, costs, and estimated baseline displacement.

### Metrics

`assistantMessages` is the accurate metric for model interactions. `calls`
remains as a **compatibility alias** so older persisted reports keep working.

Reports distinguish `invalid-output` from ordinary failures, so a formatting
problem is never conflated with a substantive one.

Session task history is rebuilt from persisted run reports, so restarting the
plugin no longer erases prior task totals. Isolated [Rift](rift.md) session
usage is captured **before** those workspaces are removed.

The report schema is **version 4**, with compatibility handling for older
totals.

## Cost reporting

Subscription-backed calls are metered at **$0** and are never presented as a
billed API charge. For comparison, you can supply API-equivalent rates:

```json
{
  "telemetry": {
    "apiEquivalentPricing": {
      "openai/gpt-5.6-sol": { "input": 5, "output": 30, "cacheRead": 0.5, "cacheWrite": 6.25 }
    }
  }
}
```

Prices are USD per **1M tokens**, used only for comparison reporting.

> [!NOTE]
> The dashboard explicitly marks calls with no configured price as **unpriced**
> rather than silently treating them as free.

Bundled rate cards are local comparison defaults — review them whenever a
provider changes its published prices.

## Quota

```json
{ "quota": { "codex": true, "refreshMs": 300000, "commandCodeMonthlyCreditsUsd": 40 } }
```

Codex quota uses the documented app-server `account/rateLimits/read` method.
Command Code uses exact observed request cost against a configured local
allowance, because no documented account-balance endpoint exists yet.

## Configuration

```json
{
  "telemetry": {
    "enabled": true,
    "reportDir": "~/.local/state/opencode-agent-flows",
    "runSummaryToast": true,
    "dashboard": true,
    "retentionDays": 90,
    "displacementEfficiency": 0.75
  }
}
```

After each completed run an optional toast shows subagent count, estimated
savings, and metered cost.

## Feedback and experiments

Record how a run went:

```text
flow_feedback rating=good note="clean delegation, no escalation needed"
```

Developer evaluation mode runs shadow planners, shadow implementers, and blind
audit reviewers on a sample of runs. It persists across restarts and is toggled
without editing config:

```text
flow_developer_mode enabled=true auditReview=true sampleRate=0.25
```

All evaluator agents are registered at startup but stay inactive until enabled.
They never modify production files.

## Estimation caveat

The estimator is model-independent: flows declare semantic roles, billing
sources, and a baseline agent, and reports preserve the actual provider and
model. Capacity savings remain an **estimate**, because subscription limits are
not token-metered.
