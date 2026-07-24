# Manual Verification Checklist

Use this checklist after restarting OpenCode and T3 Code. Mark each item with
the OpenCode version, client, repository, result, and report path. Do not test
guardrails or shadow behavior against uncommitted work you cannot recreate.

## Test Record

```text
Date:
Plugin commit/version:
OpenCode version:
Client: T3 Code / TUI / desktop / other
Repository:
Operating system:
Flow:
Configuration:
```

## Startup And Registration

- [x] OpenCode starts without a configuration validation error.
- [x] The selected flow is the default primary agent.
- [x] `bulk`, `routine`, `reviewer`, and escalation agents appear as subagents.
- [ ] `flow_status`, `flow_dashboard`, `flow_feedback`, and
      `flow_approve_escalation` are available.
- [ ] Restarting OpenCode does not delete prior reports.
- [ ] Disabling telemetry leaves normal flow execution working.

## Run, Session, And Global Scope

- [ ] Send one root request that does not delegate.
- [ ] Confirm `latest-run.md` reports zero spawned subagents.
- [ ] Send another request in the same conversation that delegates once.
- [ ] Confirm the run report counts only the second turn's child activity.
- [ ] Confirm the session report includes both turns.
- [ ] Confirm the global report includes both completed runs.
- [ ] Confirm duplicate `session.idle` and `session.status: idle` events do not
      produce duplicate run files.
- [ ] Confirm nested subagents are included recursively.

## T3 Code And Cross-Client UI

- [ ] Complete a run in T3 Code and confirm a run-summary toast is visible.
- [ ] Verify the toast shows subagent count, estimated savings, and metered cost.
- [ ] Disable `telemetry.runSummaryToast` and confirm the toast disappears.
- [ ] Ask the agent to call `flow_status` with `run`, `session`, and `global`.
- [ ] Confirm each response clearly identifies its scope.
- [ ] Call `flow_dashboard` and open the returned `file://` URL.
- [ ] Confirm the dashboard works without internet access.
- [ ] Confirm the dashboard is usable on a narrow/mobile viewport.
- [ ] Confirm no prompt text, source diff, or tool output appears in dashboard
      HTML or JSON reports.

## Task And Subagent Tracking

- [ ] Run a routine task and confirm agent, model, provider, and billing source.
- [ ] Run a bulk task and confirm it appears separately.
- [ ] Run a deep escalation and confirm it is a child session but does not count
      as non-baseline billing offload.
- [ ] Confirm task start, completion, and duration are recorded.
- [ ] Force a task failure and confirm the failed count increases.
- [ ] Verify task linking is labeled `correlated`, not `exact`.
- [ ] Compare reported child count against OpenCode's visible child sessions.

## Dynamic Verification

- [ ] Test a TypeScript repository with package scripts and existing tests.
- [ ] Confirm the orchestrator discovers available checks before choosing one.
- [ ] Make a small isolated change and confirm it chooses a targeted check.
- [ ] Make a high-risk or cross-package change and confirm it considers broader
      verification.
- [ ] Confirm test, typecheck, lint, build, and HTTP commands are categorized.
- [ ] Deliberately cause one targeted test failure.
- [ ] Confirm the worker receives the failure and attempts a bounded repair.
- [ ] Confirm no more than the configured worker attempts occur.
- [ ] Confirm repeated failure escalates instead of looping indefinitely.
- [ ] Confirm a passing command is described as evidence, not proof.
- [ ] Repeat in a Java, Python, or other repository and record discovery gaps.

## Milestone Reviewer

- [ ] Confirm incremental commits use lint, types, and relevant tests without a
      reviewer call.
- [ ] Complete a substantial changeset and confirm reviewer receives final state.
- [ ] Confirm the reviewer receives a compact packet, not the whole repository.
- [ ] Confirm malformed packets without milestone headings are rejected.
- [ ] Confirm reviewer sessions and cost appear separately.
- [ ] Confirm reviewer findings do not automatically overwrite correct work.
- [ ] Triage each finding as agreed/fixed or dismissed with a reason.
- [ ] Confirm a second review is rejected without non-trivial fixes and finding
      disposition, and a third review is always rejected.
- [ ] Make the reviewer unavailable and confirm the flow discloses it and runs
      one diff self-review without an output-format retry.
- [ ] Compare reviewer cost with worker cost for at least ten tasks.

## Rift-Isolated Writers

- [ ] Use `flow_rift_status` on a supported filesystem.
- [ ] Confirm `flow_rift_init` opens a permission prompt before modifying the
      workspace layout.
- [ ] Start from staged, unstaged, and untracked changes; call `flow_rift_begin`;
      confirm the baseline preserves all three.
- [ ] Run two disjoint `flow_rift_task` calls concurrently and integrate them.
- [ ] Confirm neither worker modifies the live checkout before integration.
- [ ] Confirm undeclared worker files and overlapping worker edits are rejected.
- [ ] Edit a live source file after the baseline and confirm integration refuses
      to overwrite it.
- [ ] Confirm absolute or workspace-escaping symlinks are rejected.
- [ ] Confirm unsupported filesystems fail explicitly without shared-writer
      fallback.
- [ ] Run combined deterministic checks after integration, then milestone review.

## Developer Evaluation Modes

- [ ] Set `developer.enabled` to `true` with a fixed sample salt.
- [ ] Set sample rate to `1` for controlled testing, then restore it.
- [ ] Enable only `auditReview`; confirm only the audit evaluator runs.
- [ ] Enable only `shadowPlanning`; confirm it runs before implementation.
- [ ] Enable only `shadowImplementation`; confirm it creates a read-only patch
      proposal and does not modify production files.
- [ ] Enable audit and shadow planning together; confirm both run once.
- [ ] Disable all three options; confirm no evaluator runs.
- [ ] Repeat the same deterministic run identifier and salt where possible;
      confirm sampling remains stable.
- [ ] Confirm evaluator output contains a valid `<flow-evaluation>` marker.
- [ ] Confirm invalid evaluator JSON becomes unknown evidence rather than a
      plugin failure.
- [ ] Confirm evaluator cost is excluded from production value calculations.
- [ ] Confirm model identity and price are hidden from blind audit prompts.
- [ ] Manually compare audit verdicts with test results and your own judgment.

## Explicit Quality Feedback

- [ ] Call `flow_feedback` with good, mixed, and bad ratings on separate runs.
- [ ] Confirm feedback appears in the latest run and global dashboard.
- [ ] Confirm ordinary positive or negative conversation text is not silently
      converted into feedback.
- [ ] Confirm notes longer than the configured limit are rejected.

## Codex / ChatGPT Quota

- [ ] Run `codex` interactively and confirm it is authenticated.
- [ ] Enable `quota.codex` and restart OpenCode.
- [ ] Confirm the report source is `codex` and status is `available`.
- [ ] Compare primary/secondary percentages with the Codex status line.
- [ ] Confirm plan type matches the expected account.
- [ ] Confirm Codex and OpenCode are authenticated to the same account.
- [ ] Confirm reset timestamps are plausible.
- [ ] Temporarily make `codex` unavailable and confirm quota status becomes an
      error without breaking the flow.
- [ ] Confirm quota refresh respects `quota.refreshMs`.

## Command Code Budget

- [ ] Configure `quota.commandCodeMonthlyCreditsUsd` with the actual allowance.
- [ ] Run a Command Code worker and compare report cost with provider usage.
- [ ] Confirm multiple runs accumulate local spend.
- [ ] Confirm evaluator spend is visible separately.
- [ ] Remove the configured allowance and confirm status becomes unavailable,
      not a fabricated remaining balance.
- [ ] At billing-cycle rollover, archive or reset the state directory according
      to the operational policy chosen before release.

## Escalation Firewall

- [ ] Attempt direct `extreme-medium` delegation without approval; confirm it is
      blocked.
- [ ] Call `flow_approve_escalation`; confirm OpenCode shows a permission prompt.
- [ ] Deny the prompt and confirm escalation remains blocked.
- [ ] Approve it and confirm one escalation succeeds.
- [ ] Attempt a second escalation and confirm approval was consumed.
- [ ] Confirm `deep` also requires one-use approval and prior concrete routine
      failure or blocker evidence.

## Protected Paths

- [ ] From a worker, attempt to edit a disposable `.env` fixture; confirm block.
- [ ] Test disposable authentication, billing, infrastructure, migration, and
      workflow paths.
- [ ] Confirm the orchestrator can still handle an explicitly approved safe
      change when repository policy permits it.
- [ ] Configure repository-specific protected paths and confirm they apply.
- [ ] Confirm similarly named harmless paths do not produce unacceptable false
      positives; record any pattern needing refinement.

## Generated Flow Documentation

- [ ] Open `docs/flows/<flow>.md` and render both Mermaid diagrams.
- [ ] Confirm every configured agent, model, effort, billing source, and approval
      requirement matches runtime configuration.
- [ ] Run `bun run docs:check` and confirm it passes.
- [ ] Modify a flow definition without regenerating docs and confirm the check
      fails; then run `bun run docs` to restore it.

## Failure And Recovery

- [ ] Interrupt OpenCode during a run and confirm the next startup still works.
- [ ] Make the telemetry directory temporarily unwritable and confirm application
      work is not lost.
- [ ] Corrupt a copied report fixture and confirm global aggregation ignores it.
- [ ] Run two OpenCode clients against separate repositories and confirm reports
      coexist without path collisions.
- [ ] Verify no credentials or authorization headers are persisted.

## Evaluation Exit Criteria

Do not make a keep/remove decision from one impressive run. Before adopting a
flow broadly, collect:

- [ ] At least 30 completed production runs.
- [ ] At least 30 sampled audit reviews across varied task types.
- [ ] At least 10 independent shadow plans.
- [ ] At least 10 cheap-review cost measurements.
- [ ] First-pass verification rate.
- [ ] Worker retry and baseline takeover rates.
- [ ] Explicit good/mixed/bad feedback distribution.
- [ ] Estimated baseline reduction with assumptions recorded.
- [ ] Command Code spend and ChatGPT rolling-window pressure.

Record the final decision and thresholds in an ADR before enabling adaptive
changes for ordinary users.
