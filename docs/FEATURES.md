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
- `flow_rift_status`: reports opt-in Rift backend availability.
- `flow_rift_init`: permission-gated Rift initialization.
- `flow_rift_begin`: snapshots an exact session baseline.
- `flow_rift_task`: runs one worker in an isolated child snapshot.
- `flow_rift_integrate`: validates and centrally applies worker changes.
- `flow_rift_cleanup`: discards unintegrated Rift workspaces.

When a run finishes, the plugin optionally shows a compact toast with subagent
count, estimated baseline reduction, and metered cost. Disable it with
`telemetry.runSummaryToast: false`.

## Task And Subagent Tracking

`tool.execute.before` and `tool.execute.after` create task traces with:

- Calling session and call ID
- Run ID
- Stable task ID
- Requested agent
- Description
- Start and completion time
- Running, completed, blocked, failed, or invalid-output state
- Link confidence

Child sessions are collected recursively at idle. Therefore nested delegation
is included in session and run reports. Evaluator agents are tagged separately
so their cost does not masquerade as production worker value.

Runs have hard task and concurrent-worker budgets. Retry limits use the stable
Task ID rather than mutable packet prose, so rewording a request cannot reset
the attempt count. Missing or malformed worker reports are failures and cannot
spawn a separate report-formatting task.

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

## Milestone Reviewer

Reviewer behavior is declared by each flow and can be overridden globally.
The current flow uses MiMo V2.5 Pro. It receives a compact packet:

- Acceptance criteria
- Final diff
- Relevant snippets
- Verification evidence

It should not receive the entire repository. Review runs over a substantial,
self-contained changeset before handoff, when explicitly requested, when
sampled, or immediately after a high-risk security, money, secrets, data
integrity, destructive lifecycle, or migration unit. It is not a per-commit
gate; lint, types, and relevant tests are the incremental gate.

The plugin requires a structured review packet and at most five concrete,
evidence-backed findings. The orchestrator agrees and fixes or dismisses each
finding with a reason. One round is normal. A second round is permitted only
after non-trivial accepted fixes and must include the finding disposition. Two
rounds is a hard ceiling. Style and findings already covered by deterministic
checks are non-blocking. If review is unavailable, the orchestrator discloses
that and performs one careful diff self-review.

## Developer Evaluation Mode

Developer mode is off by default. It uses deterministic sampling, so the same
flow, run ID, salt, and sample rate produce the same selection after restart.

Independent switches:

- `auditReview`: baseline-model blind review after implementation.
- `shadowPlanning`: baseline-model independent plan before implementation.
- `shadowImplementation`: read-only patch proposal before implementation.

The current shadow-implementation mode is deliberately read-only. A true
counterfactual implementation should use the Rift isolation backend and
artifact comparison.

## Rift-Isolated Writers

Rift snapshots preserve staged, unstaged, untracked, and non-excluded ignored
state. One immutable session snapshot becomes the parent for isolated workers.
Workers never edit the live checkout. Integration compares each worker against
the immutable baseline, accepts only files declared in its work report, rejects
cross-worker conflicts, and refuses to overwrite live files changed since the
snapshot.

Rift is experimental and opt-in. Linux requires btrfs or native reflinks;
macOS requires APFS; Windows workspace creation is unavailable. The plugin uses
the CLI rather than Node's experimental FFI and does not silently fall back to
shared concurrent writers.

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

Worker and bulk-worker agents may inspect protected paths but are blocked from
mutating tool calls whose argument path segments match them. Segment matching
blocks edits under `auth/` but does not falsely classify `translations.py` as
authentication. Defaults cover environment files, authentication, billing,
infrastructure, and migrations.

This is defense in depth. Pattern matching cannot understand every repository,
so projects should override `guardrails.protectedPaths` when their sensitive
areas use different names.

## Failure Behavior

Telemetry, dashboard, quota, and evaluator failures fail open: they log a
warning but do not invalidate completed application work. Worker/provider,
structured-output, guardrail, approval, and Rift integration failures are
explicit and fail closed because their purpose is enforcement.

Prompt text, tool output, and source diffs are not persisted by default. The
dashboard contains normalized metadata only.
