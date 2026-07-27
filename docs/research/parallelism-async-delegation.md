# Parallelism and Async Delegation: Execution Semantics, Limits, and Safe Next Steps

Date: 2026-07-27

This report establishes what parallelism means *today* in the
`opencode-agent-flows` plugin, what OpenCode's task API does and does not
support, and where safe concurrency improvements can be made without
upstream changes. It also answers whether more parallelism is currently
advisable given the shared-workspace risk profile and the absence of
background task primitives.

Every claim about repository behavior is validated against current source
code. Every claim about OpenCode's API surface is validated against
official docs. Uncertain execution boundaries are labelled.

## 1. Execution Semantics (Validated)

There are three distinct execution modes in play. They are often conflated
in discussion; keeping them separate is essential for design decisions.

### 1.1 Synchronous Blocking Task Delegation (current default)

When the orchestrator calls the `task` tool, OpenCode spawns a child
subagent session, runs it to completion (or steps limit), and returns the
result. The orchestrator **blocks** on this call — it does not resume
execution until the child finishes or hits an error.

**Evidence (code):** The plugin's `tool.execute.before` hook intercepts
the `task` tool (`plugin.ts:1037`), records a `TaskTrace` with
`status: "running"` (`plugin.ts:1104-1116`), and the `tool.execute.after`
hook processes the result when the call returns (`plugin.ts:1141`). There
is no `task_start`/`task_poll` pattern, no deferred handle, and no
callback-based completion.

**Evidence (OpenCode docs):** The OpenCode agent docs describe subagents
invoked via the `task` tool as child sessions. The plugins docs list only
`tool.execute.before` and `tool.execute.after` hooks. There is no
`task.started`, `task.completed`, background session, or deferred-completion
event. No `task_start` or `task_poll` tool appears in the built-in tools
list, the SDK, or the plugin event reference.

**Conclusion:** The `task` tool is a standard blocking tool call. One call,
one child session, one result. No async.

### 1.2 Concurrent Tool Calls in One Orchestrator Turn (the real parallelism)

The orchestrator can issue **multiple `task` tool calls in a single
assistant turn**. The LLM emits several tool calls at once, OpenCode
executes them, and the orchestrator processes all results when the batch
returns. This is not `Promise.all` in plugin code — it is the model's
multi-tool-call capability exercised by the orchestrator prompt.

**Evidence (code):** The concurrency enforcement is in
`tool.execute.before` at `plugin.ts:1044-1047`:

```typescript
const runningWorkers = runTasks.filter(
  (task) => task.status === "running" &&
    ["worker", "bulk-worker"].includes(metadata[task.agent ?? ""]?.role ?? "")
).length
if (runningWorkers >= orchestrationPolicy.maxConcurrentWorkers)
  throw new Error(`run reached the ${orchestrationPolicy.maxConcurrentWorkers}-worker concurrency limit...`)
```

This check fires for each task delegation in sequence (before hooks are
synchronous), but the `runningWorkers` count only reaches the limit when
multiple tasks are in-flight simultaneously — which happens when the
orchestrator emits multiple `task` calls in one turn, and they are
processed before any `tool.execute.after` fires for this batch.

**Evidence (prompt):** The orchestrator prompt instructs:

> "Build a small dependency graph for multi-part work. Dispatch up to three
> independent read-only or rigorously disjoint units concurrently in one
> turn; keep dependent or overlapping writes serial."
> (`src/flows/openai-commandcode-router.ts:34`,
> `src/orchestration/roles.ts:41`)

**Evidence (telemetry):** The recorded run `msg_f744...` completed 14
parallel read-only research tasks in 15.88 minutes of wall time versus
82.75 minutes of summed worker time — a 5.21x speedup — with task starts
"within milliseconds of one another"
(`docs/research/parallel-review-orchestration.md:199-201`).

**What this is NOT:** There is no `Promise.all` dispatching tasks in
plugin code. The only `Promise.all` in `plugin.ts` is in `collectSessions`
(`plugin.ts:553-554`), which reads child-session messages for telemetry
finalization — it does not dispatch tasks.

### 1.3 True Non-Blocking Background Delegation (not available)

A true background/deferred pattern would be: the orchestrator calls
`task_start`, receives a job handle immediately, continues other work, and
collects the result later via `task_poll`. This **does not exist** in
OpenCode's current API surface. Neither the OpenCode docs nor the plugin
hooks reference any background session, deferred task, or
start/poll/completion-event API.

**Evidence:** The OpenCode agent docs (`https://opencode.ai/docs/agents/`)
describe subagents as child sessions invoked via the `task` tool — no
separate start/poll mechanism. The plugins docs
(`https://opencode.ai/docs/plugins/`) list events available to plugin
hooks: `tool.execute.before`, `tool.execute.after`, `session.idle`,
`session.status`, `session.error`, etc. No `task.started`,
`task.completed`, or `task.progress` event exists. No background session
API.

The `antigravity_background_start` and `antigravity_background_poll` tools
are **Antigravity's own API**, not OpenCode's. They delegate work to
Gemini on Google's servers via the `agy` CLI; the poll is over an
Antigravity job ID, not an OpenCode task
(`src/orchestration/antigravity.ts:1-8`).

**Conclusion:** True async task delegation requires upstream OpenCode
primitives (`task_start`/`task_poll` or a background session API). Nothing
in the current plugin or OpenCode platform can implement non-blocking
background delegation beyond the orchestration-tier Antigravity delegation
(which runs on Google's servers, not in the local workspace).

## 2. Concurrency Limits and Plumbing

| Layer | Mechanism | File:Line |
|---|---|---|
| Orchestrator prompt | "Dispatch up to three independent... units concurrently in one turn" | `src/flows/openai-commandcode-router.ts:34` |
| Concurrency gate | Hooks reject `task` when `runningWorkers >= maxConcurrentWorkers` | `plugin.ts:1044-1047` |
| Default limit | `maxConcurrentWorkers: 3` in flow definition | `src/flows/openai-commandcode-router.ts:141` |
| Configurable limit | `options.orchestration.maxConcurrentWorkers` overrides default | `plugin.ts:513` |
| Config clamping | User config clamped to [1, 8] via `normalizeOrchestrationConfig` | `src/orchestration/config.ts:147` |
| Task budget | `maxTasksPerRun: 12`, clamped to [1, 50] | `plugin.ts:1042`, `src/orchestration/config.ts:146` |
| Duplicate guard | Rejects a second `task` for same agent+taskID while one is running | `plugin.ts:1078-1079` |
| Attempt limiter | Keys by `runID:agent:taskID`, max `verification.maxWorkerAttempts` (2) | `plugin.ts:1081-1084` |

The concurrency gate is a **synchronous point-in-time check**. It can only
reject a task when the running-worker count is already at the limit. It
cannot implement dynamic frontier scheduling (dispatch-ready-now, re-dispatch
when one completes, partial collection for downstream tasks). The
orchestrator must do frontier planning in its own prompt; the plugin only
enforces the upper bound.

## 3. Dependency-Frontier Planning (Prompt-Enforced)

The orchestrator prompt instructs the model to build a small dependency
graph and dispatch independent workers concurrently. This is the only
frontier mechanism. There is no plugin-level task graph, no dependency
edge recording, and no automated re-dispatch when a frontier completes.

**What the prompt gets right:**

- It tells the orchestrator to identify independent vs. dependent work.
- It caps concurrent dispatch at the configured limit.
- It says "integrate a completed frontier before dispatching the next one."

**What the prompt cannot enforce:**

- The model may misclassify dependent work as independent.
- The model may dispatch tasks before fully decomposing the problem.
- There is no write-set collision detection — the prompt says "rigorously
  disjoint" but cannot verify it.
- There is no mechanism to collect partial results without waiting for
  stragglers.

**Recorded frontier straggler risk:** The research report notes that "a
single 30-minute worker can still hold the whole frontier" because the
orchestrator resumes only after the batch returns
(`docs/research/parallel-review-orchestration.md:409-421`).

## 4. Shared-Workspace Write Risks

All workers share the same filesystem. The plugin has **no write-set
collision detection**. There is no declaration of which files a worker
intends to modify, no lock mechanism, and no merge-conflict detection
beyond what Git would provide after the fact.

**Existing protections (all insufficient for concurrency):**

| Protection | Scope | Effective for parallel writes? |
|---|---|---|
| `pathProtected` guard (`plugin.ts:121-129`) | Blocks tool calls matching protected path patterns | No — security, not concurrency |
| Edit/bash deny for reviewers (`plugin.ts:1035-1036`) | Read-only enforcement | No — workers have full edit access |
| `task` deny for subagents | Prevents recursive delegation | No — unrelated to write coordination |
| Work report `filesChanged` field | Worker self-reports modified files | No — post-hoc, not preventive |

**What can cause silent corruption with parallel writers:**

1. Two workers edit the same file concurrently → last writer wins.
2. Worker A runs a formatter, Worker B edits generated files → race.
3. Workers contend for ports, Docker names, lockfiles, caches, temp files.
4. Worker A's test run against Worker B's in-progress changes → false
   failures.
5. Workers perform `git` operations (checkout, merge, rebase) on the
   shared repository → index corruption.

**The prompt mitigates this only by telling the orchestrator to keep
writes serial and run independent units concurrently.** This is advisory
— the model can ignore it.

## 5. What Can Be Enforced Here vs. Upstream

| Capability | Can enforce in plugin today? | Requires upstream? |
|---|---|---|
| Max concurrent workers | Yes — `tool.execute.before` gate (`plugin.ts:1044-1047`) | No |
| Max tasks per run | Yes — count check (`plugin.ts:1042-1043`) | No |
| Task-level attempt limit | Yes — `taskAttempts` map keyed by stable task ID (`plugin.ts:1081-1084`) | No |
| Duplicate concurrent guard | Yes — rejects same agent+taskID (`plugin.ts:1078-1079`) | No |
| Frontier dependency graph | **Prompt only** | Plugin-level graph → feasible but needs orchestrator output parsing |
| Write-set collision detection | **No** — no file-intent declaration | Feasible with structured work packet + hook checking |
| Dynamic frontier re-dispatch | **No** — orchestrator blocks on batch | Needs `task_start`/`task_poll` or completion events |
| Partial result collection | **No** — batch is all-or-nothing | Needs `task_start`/`task_poll` |
| Non-blocking background delegation | **No** — no API exists | Yes — needs new OpenCode primitives |
| Workspace isolation (Rift/worktrees) | **No** — code removed | Yes — needs deliberate isolation backend |

## 6. Antigravity Background Delegation (Separate System)

The Antigravity tools (`antigravity_background_start` /
`antigravity_background_poll`) are **Google-hosted Gemini delegation**,
not local workspace task execution. They operate on Google's servers via
the `agy` CLI, are read-only by default, and cannot edit local files
unless `allowEdits` is explicitly set.

**Key properties (from `src/orchestration/antigravity.ts`):**

- Runs on Google AI Pro subscription.
- Suitable for: vision analysis, large-context reads, bulk triage,
  non-blocking summary/draft work.
- Not suitable for: agentic loops, implementation, local file edits,
  milestone review.
- The orchestrator prompt restricts it to Gemini models only; Claude and
  other non-Google models must not be routed through Antigravity.

This is **true non-blocking background delegation** but for a different
scope (Google-hosted read/analysis), not local workspace task execution.

## 7. Isolation: Rift and Git Worktrees (Future Only)

The repository intentionally removed Rift isolation. No isolation code
exists in current `plugin.ts` or any source file. The `docs/research/`
reports reference Rift and Git worktrees as design options, not
implemented features.

**Key constraints for any future isolation:**

- Rift requires btrfs/reflink/APFS filesystem; this machine's filesystem
  reports ext2/ext3, which does not meet Rift's Linux backends.
- Rift is explicitly labelled experimental by its repository.
- Git worktrees cannot reproduce a dirty parent checkout from `HEAD`.
- Both require explicit opt-in, a clean/dirty parent policy, a common
  backend interface, central integration, and post-integration verification.
- Applying isolated results back to the user workspace requires
  change-tracking between the user's state and the session baseline.

The companion report `parallel-review-orchestration.md` recommends this
sequencing:

1. Shared checkout for read-only work.
2. Rift for isolated writers when supported + explicitly enabled.
3. Git worktrees for clean committed bases.
4. Serial execution when no isolation backend can safely represent the
   current state.

> **Note:** `docs/research/parallel-review-orchestration.md:38-40`
> originally recommended Rift as the "stronger isolation candidate." This
> report does not repeat that recommendation. Rift isolation is an
> explicit future option requiring a deliberate architectural reversal.
> The current codebase has no isolation support.

## 8. Prioritized Recommendations

### P0: Safe Parallelism With What Exists

1. **Refine the prompt to emphasize write-disjointness.** The prompt
   already says "rigorously disjoint units." Add explicit verification
   that the orchestrator should: (a) check the `filesChanged` fields of
   workers in a frontier before dispatching another, and (b) require
   workers to declare their expected file scope in the work packet.

2. **Add a write-set overlap warning in `tool.execute.after`.** When
   multiple workers in the same batch report overlapping `filesChanged`,
   append a warning to the orchestrator's context. This does not prevent
   corruption but makes it visible.

3. **Keep the concurrency limit at 3 for writes.** Only read-only work
   (Explore-style exploration, `grep`/`glob`/`read`-only workers) should
   be fully parallel. The current prompt and limit already support this;
   make the read-only/write distinction explicit.

4. **Add a "read-only worker" role flag** to `AgentMetadata` so the
   concurrency gate can distinguish read-only workers (no de-facto limit
   beyond `maxConcurrentWorkers`) from writers (limit 1 or 2).

### P1: Structured Dependency Frontier

5. **Parse `Task ID` from work packets in `tool.execute.before`** and
   record `dependsOn` edges when the orchestrator declares them. This
   enables plugin-level dependency validation (reject dispatching a task
   whose dependency hasn't completed).

6. **Record frontier metrics in telemetry:** ready time, dispatch time,
   completion time, critical-path wall time, and straggler identification.

### P2: Requires Upstream Changes

7. **Propose `task_start` / `task_poll` to OpenCode.** This is the
   prerequisite for dynamic frontier scheduling, partial result collection,
   and non-blocking background delegation. Without it, the orchestrator
   will always block on a batch.

8. **Propose a `session.background` event or background session mode.**
   Needed for truly non-blocking worker dispatch where the orchestrator
   can continue planning while workers execute.

### P3: Future Isolation (Requires Architecture Reversal)

9. **Add workspace isolation only after:** stable task identity,
   structured dependency edges, central integration, dirty-checkout
   handling, and resource namespace isolation have explicit policies.

10. **Evaluate Rift as an opt-in experimental backend**, not a default.

## 9. Anti-Patterns

| Anti-pattern | Why it's dangerous | Current status |
|---|---|---|
| "Dispatch everything in parallel" | Multiple writers on shared checkout → silent corruption | Prevented by maxConcurrentWorkers=3 and prompt instructions |
| "Just use Promise.all" | OpenCode's `task` tool is synchronous; plugin cannot fan out | Not used for task dispatch in this codebase |
| "Background jobs without isolation" | Background worker's edits race with foreground | Only Antigravity background exists, and it's read-only by default |
| "Silent stashing/committing dirty state" | User work is lost when isolation backend needs a clean base | Explicitly forbidden in research docs; no implementation exists |
| "Assume models respect concurrency instructions" | Prompt-enforced parallelism is advisory | Currently the ONLY frontier mechanism; needs tech enforcement |
| "Worktrees solve everything" | Dirty parent, port conflicts, and logical merge conflicts persist | Recognized in research docs; worktree backend does not exist |
| "Rift is ready" | Experimental, filesystem-limited, and code was intentionally removed | Explicitly noted; see Section 7 |

## 10. Decision: Is More Parallelism Currently Advisable?

**A qualified yes — for read-only work.**

- **Read-only exploration/research tasks**: safe to fan out to the
  `maxConcurrentWorkers` limit (3). Evidence: 5.21x speedup in recorded
  research runs with no corruption. Can be further refined by adding a
  read-only role flag that permits a higher limit.

- **Parallel writers on shared checkout**: not advisable without write-set
  collision checks. The prompt says "rigorously disjoint" but cannot
  enforce it. The plugin has no file-intent declaration or overlap
  detection. The safest path is: serialize writes, integrate centrally,
  test once. Parallel writes should wait for P1 structured dependency
  tracking or P3 workspace isolation.

- **Dynamic frontier re-dispatch**: not possible without upstream
  `task_start`/`task_poll`. The current blocking batch model means the
  orchestrator must correctly size each frontier — too many tasks, and a
  straggler holds everyone; too few, and potential parallelism is wasted.

- **True background delegation**: only available via Antigravity/Gemini
  for read/analysis work outside the local workspace. Not suitable for
  implementation.

**Recommended posture:** Keep the current 3-worker concurrency limit.
Refine the prompt to distinguish read-only from write work. Add write-set
overlap warnings. Do not add isolation backends or dynamic scheduling
until the prerequisite upstream APIs and structured dependency tracking
exist.

## 11. Ownership Table

| Component | Owner | File / Source |
|---|---|---|
| Task tool (synchronous blocking) | OpenCode (upstream) | `https://opencode.ai/docs/agents/` |
| Concurrent tool calls in one turn | LLM + orchestrator prompt | Prompt at `src/flows/openai-commandcode-router.ts:34` |
| Concurrency limit enforcement | Plugin hook | `plugin.ts:1044-1047` |
| Attempt limiter (stable task ID) | Plugin hook | `plugin.ts:1081-1084` |
| Frontier planning (dependency graph) | Orchestrator prompt | Prompt at `src/flows/openai-commandcode-router.ts:34` |
| Write-set collision detection | **Not implemented** | — |
| Workspace isolation (Rift/worktrees) | **Not implemented** (removed) | — |
| Antigravity background delegation | Antigravity plugin (separate) | `src/orchestration/antigravity.ts`, `agy` CLI |
| Telemetry (`Promise.all` for sessions) | Plugin `collectSessions` | `plugin.ts:553-554` |
| `task_start` / `task_poll` | **Does not exist** | Not in OpenCode docs or source |

## Sources

1. OpenCode, "Agents": subagents, task tool, steps, permissions.
   https://opencode.ai/docs/agents/

2. OpenCode, "Tools": built-in tools list — no `task_start`/`task_poll`.
   https://opencode.ai/docs/tools/

3. OpenCode, "Plugins": plugin hooks, tool execution events — no
   background session or deferred task events.
   https://opencode.ai/docs/plugins/

4. OpenCode, "Permissions": task permission configuration, granular rules.
   https://opencode.ai/docs/permissions/

5. OpenAI Agents SDK, "Guardrails": input/output guardrails at the runtime
   boundary.
   https://openai.github.io/openai-agents-js/guides/guardrails/

6. Anthropic, "Building effective agents": parallel sectioning,
   orchestrator-workers, stopping conditions.
   https://www.anthropic.com/engineering/building-effective-agents

7. Claude Code, "Agent teams": independence requirements, token overhead,
   recommended team size, write-conflict warnings.
   https://code.claude.com/docs/en/agent-teams

8. Claude Code, "Worktrees": isolated subagents, environment setup,
   cleanup.
   https://code.claude.com/docs/en/worktrees

9. Rift specification: copy-on-write backends, CLI lifecycle, experimental
   status.
   https://github.com/anomalyco/rift/blob/dev/specs.md

10. Anomaly, Rift README: Git-state preservation, hooks, filesystem
    requirements.
    https://github.com/anomalyco/rift

## Local Evidence

- `plugin.ts` — all hook implementations, concurrency gate, attempt
  limiter, task tracing
- `src/flows/openai-commandcode-router.ts` — built-in flow definition,
  orchestrator prompt, concurrency defaults
- `src/orchestration/roles.ts` — custom-flow role templates, parallel
  frontier prompt
- `src/orchestration/config.ts` — config clamping, `maxConcurrentWorkers`
  bounds
- `src/orchestration/antigravity.ts` — Antigravity detection, background
  delegation scope
- `src/types.ts` — `OrchestrationPolicy`, `FlowDefinition`,
  `AgentMetadata` types
- `src/telemetry/types.ts` — `TaskTrace`, report schema — no concurrency
  or frontier fields
- `docs/research/parallel-review-orchestration.md` — baseline research on
  parallel scheduling, Rift evaluation, recorded speedups
- `docs/research/orchestration-reliability.md` — P0 defects, attempt
  limiter behavior, structural stop conditions
- `tests/plugin.test.ts` — concurrency limit test ("enforces task and
  concurrent worker budgets"), attempt limit tests
