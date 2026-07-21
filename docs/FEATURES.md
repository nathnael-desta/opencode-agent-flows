# Plugin Features

This document describes plugin-wide capabilities. Flow-specific models and
routing rules live in generated files under `docs/flows/`.

## Scope Model

OpenCode does not expose a first-class run object. The plugin defines:

- **Run:** one user message sent to the root flow agent, ending when the root
  session becomes idle after all delegated work returns.
- **Session:** the root OpenCode session and all descendants across every run.
- **Global:** every materialized run in the configured telemetry directory.

This distinction prevents a subagent count from being ambiguous. A run report
contains subagents spawned during that turn; a session report contains the
whole conversation tree; the global report aggregates persisted runs.

## Model-Independent Telemetry

The plugin records actual provider, model, agent, token, cost, timing, task,
verification, and child-session data. It does not infer delegation from a
provider name. Delegation is identified from child sessions and task calls;
billing semantics come from each flow's `agentMetadata`.

Each flow declares a baseline agent. Estimated capacity reduction compares
work sent to non-baseline billing sources with total production work. Generic
workload units normalize input, output, reasoning, and cache tokens without
using one provider's prices. The displacement-efficiency option discounts the
estimate for orchestration and handoff overhead.

Reports label uncertain values. Task-to-child relationships are currently
`correlated` because OpenCode does not expose a durable task-call foreign key.

## Reports And UI

The default state directory is:

```text
~/.local/state/opencode-agent-flows/
```

Important outputs:

```text
latest-run.json       Machine-readable latest run
latest-run.md         Cross-client latest-run report
latest-session.json   Machine-readable session report
latest-session.md     Cross-client session report
global.json           Aggregate data
global.md             Aggregate Markdown report
dashboard.html        Self-contained browser dashboard
runs/*.json           Immutable run materializations
sessions/*.json       Latest materialization per root session
```

The dashboard is a self-contained local HTML file. It uses no server, remote
JavaScript, font, analytics, or source-code content. This makes it usable from
T3 Code, the OpenCode TUI, desktop clients, or a normal browser.

Custom tools:

- `flow_status`: returns run, session, or global Markdown.
- `flow_dashboard`: returns dashboard and report paths.
- `flow_feedback`: records explicit good, mixed, or bad feedback.
- `flow_approve_escalation`: opens a permission prompt for a gated agent.

When a run finishes, the plugin optionally shows a compact toast with subagent
count, estimated baseline reduction, and metered cost. Disable it with
`telemetry.runSummaryToast: false`.

## Task And Subagent Tracking

`tool.execute.before` and `tool.execute.after` create task traces with:

- Calling session and call ID
- Run ID
- Requested agent
- Description
- Start and completion time
- Completion or failure state
- Link confidence

Child sessions are collected recursively at idle. Therefore nested delegation
is included in session and run reports. Evaluator agents are tagged separately
so their cost does not masquerade as production worker value.

## Dynamic Verification

Verification is repository-dependent. The flow prompt instructs the
orchestrator to discover commands from manifests, CI, repository instructions,
and existing tests, then choose the smallest relevant check.

Recommended levels:

| Level | Check |
|---|---|
| 0 | Diff, syntax, and static inspection |
| 1 | Tests directly related to changed files |
| 2 | Affected package tests, lint, or typecheck |
| 3 | Full suite for high-risk or cross-cutting changes |

Workers receive a bounded number of attempts to fix verification failures.
The default flow permits two attempts before escalation. The plugin observes
`bash` commands and classifies tests, typechecks, linters, builds, and HTTP
checks. A successful command is evidence, not proof that the implementation is
correct.

`verification.autoRun` is reserved for future deterministic command execution.
The current implementation lets the active agent select and run commands under
normal OpenCode permissions; the plugin records the result.

## Cheap Reviewer

Reviewer behavior is declared by each flow and can be overridden globally.
The current flow uses MiMo V2.5 Pro. It receives a compact packet:

- Acceptance criteria
- Final diff
- Relevant snippets
- Verification evidence

It should not receive the entire repository. The reviewer is useful when
verification is missing or failed, risk is high, or a review is sampled. Its
findings are model evidence, not ground truth.

## Developer Evaluation Mode

Developer mode is off by default. It uses deterministic sampling, so the same
flow, run ID, salt, and sample rate produce the same selection after restart.

Independent switches:

- `auditReview`: baseline-model blind review after implementation.
- `shadowPlanning`: baseline-model independent plan before implementation.
- `shadowImplementation`: read-only patch proposal before implementation.

The current shadow-implementation mode is deliberately read-only. A true
counterfactual implementation would require an isolated worktree and artifact
comparison; the plugin does not claim that yet.

Evaluator prompts require a structured `<flow-evaluation>` marker. Parsed
scores and verdicts are stored as quality evidence. The plugin computes costs,
usage, retries, and latency deterministically rather than asking the evaluator
to invent financial numbers.

## Quality Evidence

Quality combines evidence rather than producing a fake universal score:

- Explicit user feedback
- Verification outcomes
- Cheap-review verdicts
- Sampled audit reviews
- Shadow-plan comparisons
- Shadow-implementation proposal comparisons
- Retry, failure, and escalation counts

Reports show evidence count and confidence. Meaningful flow decisions require a
sample across varied tasks. A reasonable initial target is 30-50 audited tasks
and at least 10 independent shadow comparisons.

## Quota And Budget Tracking

### Codex / ChatGPT

When `quota.codex` is enabled, the plugin starts `codex app-server --stdio`,
performs the documented JSON-RPC initialization, and calls:

```text
account/rateLimits/read
```

This returns provider-reported used percentages, window durations, reset times,
and plan type. It is superior to scraping the Codex terminal UI. The Codex CLI
and OpenCode must use the same ChatGPT account for the result to be meaningful.

### Command Code

Command Code message responses provide exact observed per-call cost. The plugin
sums that cost and compares it with `quota.commandCodeMonthlyCreditsUsd`.
This is local budget accounting, not an authoritative account balance. The
provider integration currently has no documented public balance endpoint.

The two resources should not literally reach zero simultaneously: ChatGPT uses
rolling windows while Command Code credits use a billing period. The dashboard
instead compares current usage pressure.

## Escalation Firewall

Flows mark approval-gated agents in `agentMetadata`. A direct task call to one
of those agents is rejected unless `flow_approve_escalation` has opened and
completed an OpenCode permission prompt. Approval is consumed after one use.

This is a technical boundary, unlike a prompt-only instruction.

## Protected Paths

Worker and bulk-worker agents are blocked from tool calls whose arguments match
configured protected paths. Defaults cover environment files, secrets,
credentials, authentication, billing, infrastructure, migrations, and GitHub
workflows.

This is defense in depth. Pattern matching cannot understand every repository,
so projects should override `guardrails.protectedPaths` when their sensitive
areas use different names.

## Failure Behavior

Telemetry, dashboard, quota, and evaluator failures fail open: they log a
warning but do not invalidate completed application work. Guardrail and
approval failures fail closed because their purpose is enforcement.

Prompt text, tool output, and source diffs are not persisted by default. The
dashboard contains normalized metadata only.
