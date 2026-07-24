# Orchestration Reliability Investigation

Date: 2026-07-23

This report investigates unusually long `opencode-agent-flows` runs, high
reported model-call totals, empty child-agent results, and malformed worker
reports. Runtime code was not changed during the investigation.

The companion report `parallel-review-orchestration.md` evaluates reviewer
remediation, parallel task frontiers, and isolated-writer worktrees.

## Executive Summary

The observed behavior has several independent causes that amplify one another:

1. Telemetry labels every token-bearing assistant message as a `call`; it does
   not count provider HTTP requests or task delegations. The reported 1,489 and
   1,625 totals are whole-session assistant-message counts accumulated across
   multiple user turns.
2. Individual runs are still genuinely excessive. The largest inspected run
   contains 699 assistant messages, 29 task invocations, and 115 detected
   verification commands over 13,364,996 ms (about 3.7 hours).
3. Missing or malformed `<flow-work-report>` output is marked as a completed
   task. In the 699-message run, 20 of 27 routine invocations had missing or
   invalid reports. The orchestrator repeatedly delegated tiny correction
   tasks such as "Return translation report", "Fix translation report schema",
   and "Return JSON work report".
4. The attempt limiter keys retries by the complete task description. Rewording
   a correction creates a new key, so the configured two-attempt limit does not
   bound the correction loop.
5. The latest reproduced empty result was a provider quota failure, not an
   empty successful generation. OpenCode persisted an explicit weekly-limit
   error in the child session, but the task result shown to the parent was
   empty. The flow's message normalizer does not copy message errors, so the
   report recorded zero model errors and classified the task as completed with
   a missing work report.
6. No OpenCode `steps` limit is configured for the orchestrator or workers.
   OpenCode therefore allows each agent to continue until the model stops or a
   user interrupts it.

The highest-value fix is not a model change. It is to make failures explicit,
bound loops structurally, and stop requiring a second model interaction merely
to repair report formatting.

## Evidence

### Telemetry Semantics

`buildFlowReport` increments `totals.calls` for each assistant message that has
a provider, model, and token usage (`src/telemetry/reports.ts:118-136`). It does
not observe provider requests.

Examples from persisted reports:

| Scope | Reported calls | Child sessions | Task invocations | Duration |
|---|---:|---:|---:|---:|
| Session `ses_0a08...` | 1,489 | 31 | 0 in latest session snapshot | Not recorded |
| Session `ses_076f...` | 1,625 | 27 | 5 in latest session snapshot | Not recorded |
| Run `msg_f83f...` | 514 | 13 | 14 | 10,372,921 ms |
| Run `msg_f8ca...` | 699 | 11 | 29 | 13,364,996 ms |

The session reports are lifetime aggregates. The session `ses_0a08...` assigns
637 messages to the root orchestrator and 852 to child agents. Calling these
values "model calls" implies a provider-level metric that the implementation
does not collect.

Session task totals are also unstable across process restarts. Task traces live
only in the plugin's in-memory `tasks` map (`plugin.ts:185`) and the session
report is rebuilt and overwritten from that map (`plugin.ts:219-238`). This
explains session reports with many child sessions but zero tasks.

### Malformed-Report Amplification

For the 699-message run:

- 27 routine task invocations
- 7 valid work reports
- 16 missing reports
- 3 invalid-schema reports
- 1 invalid-JSON report
- 1 task-level failure without a parsed report

The plugin sets a task to `completed` before parsing the report. Parse failures
only append advisory text to the task output (`plugin.ts:329`). They do not
change task status or stop another task from being created.

The trace shows repeated format-only delegations after substantive workers had
already edited and verified code. These correction tasks cost additional model
turns and continue growing the root context.

The configured attempt limit does not contain this loop. Its key includes the
entire packet description (`plugin.ts:325`), so semantically equivalent packets
with different wording are independent attempts. The report's retry metric uses
a similarly description-sensitive heuristic (`src/telemetry/reports.ts:202`),
which reports only one retry for the 29-task run despite the visible correction
sequence.

### Empty Results and Lost Errors

The latest empty routine child `ses_071352...` contains two persisted assistant
messages with this error:

> You've reached your weekly usage limit for your plan. Your limit resets at
> 2026-07-24T19:30:58.486Z.

Both messages have zero tokens and no text part. The parent therefore receives
no useful result. The flow's `RawMessage` type and `normalizeMessage` function
do not include the persisted `error` field (`plugin.ts:16,31-50`), although
report aggregation expects `MessageUsage.error` (`src/telemetry/reports.ts:136`).
The provider failure is consequently invisible in current flow telemetry.

This is a concrete repro for the recent empty result. It does not prove that
every historical empty result had the same cause.

### Missing Structural Stop Conditions

The flow config sets neither OpenCode's `steps` field nor a per-run task budget.
Its prompt instead tells the orchestrator to continue the completion loop until
acceptance criteria are met (`src/flows/openai-commandcode-router.ts:29-30`).
That instruction is useful only when paired with a hard stopping condition.

OpenCode documents `steps` as the maximum number of agentic iterations. If it
is absent, the agent continues until the model stops or the user interrupts.
The AI SDK similarly defaults agent loops to a finite 20-step limit specifically
to prevent runaway API calls and costs. Anthropic recommends stopping
conditions such as maximum iterations for autonomous agents.

### Additional Confirmed Defects

- Protected-path checks use substring matching over serialized tool arguments
  (`plugin.ts:63-65`). A real trace blocked `translations.py` because it contains
  the letters `auth`, causing a false blocker and an unnecessary escalation.
- The Command Code request timeout is cleared as soon as response headers are
  received (`src/model.ts:51-99`), before the response stream is consumed. It
  therefore does not bound stalled streaming bodies.
- The SSE parser silently discards malformed lines and ignores the top-level
  `finish` event (`src/stream.ts:94-95,140-145`). This is not implicated in the
  latest quota-error repro, but it can turn protocol drift into incomplete
  output without diagnostic evidence.
- The global `general` and `explore` agents still reference the removed
  `opencode/minimax-m2.5-free` model. Independent research and exploration
  subagents fail before execution for this reason.

## Prioritized Proposal

### P0: Stop Runaway Work

1. Set conservative OpenCode `steps` limits for orchestrator, routine, bulk,
   reviewer, and deep agents. Add a separate maximum number of task delegations
   per root run.
2. Treat provider/model errors and empty outputs as task failures. Preserve the
   actual error in the task result and telemetry instead of presenting a
   missing-report warning.
3. Treat malformed worker reports as an explicit `invalid-output` state, not
   `completed`. Permit at most one local normalization or same-session repair;
   do not spawn a new implementation worker solely to fix formatting.
4. Key attempts by a stable task identity supplied by the orchestrator or by a
   normalized objective, not the full mutable description. Apply the limit to
   report corrections as well as implementation attempts.
5. Fix stale `general` and `explore` models so diagnostic tooling can run.

Suggested acceptance criteria:

- A quota failure surfaces the provider message in the parent result and counts
  as one failed task and one model error.
- Three reworded packets for the same task cannot bypass a two-attempt limit.
- Missing report markup cannot cause more than one correction interaction.
- A root run stops at the configured task and step budgets with a clear partial
  result.

### P1: Make the Contract Reliable

1. Prefer a structured completion tool or schema-backed output over XML-wrapped
   JSON in free text. Vercel AI SDK documents schema validation through
   `Output.object`; OpenAI Agents SDK exposes `outputType` and invalid-final-
   output handling.
2. If OpenCode cannot expose schema-backed task results, parse useful prose and
   tool evidence into an internal report locally. Report formatting should not
   require another LLM call.
3. Replace protected-path substring matching with path-segment or glob matching
   against actual file arguments.
4. Keep the provider timeout active until stream completion, and expose malformed
   SSE/protocol events as errors with response metadata.

### P2: Correct Observability and Routing

1. Rename `calls` to `assistantMessages` unless true provider-request spans are
   added. Report `delegations`, `childSessions`, and `providerRequests`
   separately.
2. Persist task traces before rebuilding session reports, or aggregate session
   task totals from stored run reports. Do not overwrite historical task data
   with the current process's in-memory map.
3. Record correction count, invalid-output count, time per child, context size,
   and explicit stop reason. Distinguish provider, tool, report-contract, and
   verification failures.
4. Add direct fast paths for simple root requests and use orchestrator-worker
   routing only where dynamic decomposition is actually needed. Anthropic's
   guidance is to start with the simplest approach and add agentic complexity
   only when it demonstrably improves outcomes.

## Recommended Sequence

Implement P0 as one bounded reliability release, validate it against captured
quota-error and malformed-report fixtures, then reassess whether P1 structured
output work is still necessary. Do not tune models or prompts before the P0
control and telemetry defects are corrected; current measurements cannot
reliably distinguish model quality from hidden provider failure and loop
amplification.

After P0, implement the first phase from `parallel-review-orchestration.md`:
enforce a one-shot reviewer gate and use the task tool's existing concurrency
for read-only or rigorously disjoint work. Defer worktree-isolated writers until
stable task identity, central integration, dirty-checkout handling, and runtime
namespace isolation have explicit policies. Evaluate Rift snapshots as the
preferred dirty-workspace backend where copy-on-write filesystem support is
available; retain Git worktrees for clean committed bases.

## Primary Sources

1. OpenCode, "Agents": `steps`, permissions, subagents, and task permissions.
   https://opencode.ai/docs/agents/
2. Vercel AI SDK, "Loop Control": finite step limits, stop conditions, budget
   conditions, and context pruning.
   https://ai-sdk.dev/docs/agents/loop-control
3. Vercel AI SDK, "Generating Structured Data": schema-backed output validation
   and structured-output errors.
   https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
4. OpenAI Agents SDK, "Agents": `outputType` structured output.
   https://openai.github.io/openai-agents-js/guides/agents/
5. OpenAI Agents SDK, "Guardrails": tool/output guardrails and tripwire
   termination.
   https://openai.github.io/openai-agents-js/guides/guardrails/
6. OpenAI Agents SDK, "Running Agents": `maxTurns`, invalid final output, and
   error handling.
   https://openai.github.io/openai-agents-js/guides/running-agents/
7. Anthropic, "Building effective agents": simplicity, programmatic gates,
   environmental ground truth, and maximum-iteration stopping conditions.
   https://www.anthropic.com/engineering/building-effective-agents

## Local Evidence

- `plugin.ts`
- `src/telemetry/reports.ts`
- `src/flows/openai-commandcode-router.ts`
- `~/.local/state/opencode-agent-flows/`
- `~/.local/share/opencode/opencode.db`
- `/home/nate/code/opencode-commandcode-provider/src/model.ts`
- `/home/nate/code/opencode-commandcode-provider/src/stream.ts`
