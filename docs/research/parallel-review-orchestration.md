# Parallel Work and Bounded Review

Date: 2026-07-23

This report extends `orchestration-reliability.md` with two questions:

1. Should the reviewer fix its own findings?
2. Should the orchestrator decompose work and run multiple workers in parallel,
   potentially in temporary Git worktrees?

No runtime code was changed during this research.

## Conclusions

The current flow should not make the reviewer a general-purpose fixer. Keep an
independent, fresh-context reviewer, but make review a one-shot bounded gate
rather than an open-ended review-fix-review loop. Route accepted findings back
to the original worker or to one remediation worker, run deterministic checks,
and stop. Permit a reviewer to repair only narrowly defined mechanical issues
in an optional mode, and never let it certify its own repairs.

The flow should add parallel scheduling. The strongest design is a dependency
graph with a small ready-task frontier:

- Run read-only or demonstrably disjoint tasks concurrently.
- Use the shared checkout only for read-only work and carefully bounded,
  non-overlapping writes.
- Use isolated workspace snapshots or worktrees for multiple substantial
  writers.
- Integrate centrally and serially, then test the combined result once.
- Default to three concurrent workers and increase only when measured evidence
  shows useful independent work.

Rift is a stronger isolation candidate than Git worktrees when its filesystem
requirements are met. It copy-on-write snapshots the complete current workspace,
including staged, unstaged, untracked, and most ignored state. That directly
handles dirty starting checkouts, which worktrees cannot reproduce from `HEAD`.
It remains experimental and does not provide change integration, so it should
be an optional backend behind the same scheduler contract rather than a hard
dependency.

This is not speculative for this installation. One recorded run completed 14
parallel research tasks in 15.88 minutes of wall time versus 82.75 minutes of
summed worker time, a 5.21x effective speedup. Its five parallel correction
tasks achieved 1.91x. The long 699-message run, in contrast, executed its
substantive workers and report corrections serially.

## What the Reviewer Actually Did

Across persisted run reports:

- 25 reviewer task calls
- 136.47 total reviewer-minutes
- 3.75-minute median
- 32.49-minute maximum
- 3 reviewer calls longer than 10 minutes
- 5 reviewer task failures

The reviewer was not the only source of multi-hour runs, but it contributed
material latency and triggered longer remediation chains. Examples include:

- Review offline slice: 4.45 minutes; worker repair: 15.48 minutes; three later
  reviewer checks: 19.97 minutes.
- Payment hardening: first review 17.37 minutes; second review 6.70 minutes.
- A startup-fix review ran for 32.49 minutes and failed.
- Translation review: 5.52 minutes; subsequent worker repair: 16.78 minutes,
  followed by three report-format correction calls.

### Declared Policy Is Not Enforced

The flow declares reviewer triggers for failed verification, missing
verification, high-risk work, and a 10% sample. The plugin never reads
`flow.reviewer`, `options.reviewer`, those triggers, or the production reviewer
sample rate. They currently affect generated documentation, not runtime
behavior.

The documented compact packet is also not enforced. Recorded descriptions
include only phrases such as `Review dev startup fix` and `Review telemetry
changes`. With no supplied acceptance criteria, bounded diff, or verification
evidence, the reviewer must rediscover the task from the repository and can
become another full implementation-scale agent.

Finally, `permission: { edit: "deny" }` blocks edit tools but does not block
`bash`. The reviewer's no-edit rule is therefore prompt-enforced rather than a
complete technical boundary.

## Should the Reviewer Fix Findings?

### Adapted Milestone-Gate Practice

The supplied Codex workflow reinforces the bounded design, but its useful part
is the policy rather than the Codex model or CLI. For this flow, MiMo V2.5 Pro
remains the independent cross-family reviewer and the same milestone semantics
apply:

- Cheap lint, type checks, and relevant tests are the routine incremental gate.
- Model review runs over one substantial self-contained changeset, not every
  intermediate commit or worker result.
- Normal low-risk UI, copy, documentation, configuration, additive endpoints,
  and refactors wait for the final handoff milestone rather than triggering
  their own review.
- Security, authorization, permissions, money, balances, secrets, data
  integrity, storage lifecycle, deletion, cleanup, and migrations get an early
  review when their self-contained unit is complete.
- Every finding is triaged by the orchestrator: agree and fix now, or disagree
  and preserve a one-line reason. Reviewer output is evidence, not authority.
- Style and findings already enforced by lint, types, or tests do not block.
- One round is normal. A second round is allowed only after non-trivial accepted
  fixes because those fixes can introduce a regression. Two rounds is the hard
  ceiling.
- If the configured reviewer is unavailable or returns invalid output, the flow
  discloses that fact and performs one careful diff self-review instead of
  silently skipping the milestone or looping on output formatting.

The implemented policy enforces compact packet headings, structured findings,
finding limits, and review-round limits in plugin hooks. Prompt text remains
explanatory rather than the only control.

### Option A: Read-Only Reviewer, Unbounded Loop

This is close to current behavior.

Advantages:

- Independent context and model family reduce implementer self-confirmation.
- Findings are separated from modifications.

Problems:

- Every accepted finding requires another handoff.
- Re-review can continue indefinitely.
- Weak packets cause repository rediscovery.
- Models prompted to find gaps tend to produce findings, including marginal
  ones. Anthropic's current Claude Code guidance explicitly warns that chasing
  every reviewer finding leads to over-engineering.

Verdict: retain independence, remove the unbounded loop.

### Option B: Reviewer Always Fixes

Advantages:

- The finding context is already loaded.
- One agent can make several local corrections without another handoff.
- It can reduce latency for obvious one-line or mechanical fixes.

Problems:

- The reviewer becomes an implementer and loses independent final judgment.
- A review-oriented model may be weaker or more conservative at implementation.
- Broad write permission increases scope-creep risk.
- A fresh reviewer would still be needed to independently certify its changes,
  recreating the loop.

Verdict: do not make this the default.

### Option C: Bounded Maker-Reviewer-Remediator

Recommended lifecycle:

1. Workers implement and run focused deterministic checks.
2. The integrated change gets at most one independent review.
3. A programmatic triage gate rejects findings without severity, concrete
   evidence, affected requirement, and actionable verification.
4. Accepted findings go back to the original worker session when possible, or
   to one remediation worker when ownership spans workers.
5. The remediator gets the exact findings, final diff, and failing evidence,
   not a request to rediscover the repository.
6. Deterministic checks run on the repaired result.
7. Re-review occurs only for security, authorization, money, migrations,
   destructive data operations, or a repair that broadened scope. Otherwise
   the workflow stops.

Suggested hard limits:

- One production reviewer call per normal run.
- Two reviewer calls maximum for explicitly high-risk work.
- At most five findings, ordered by severity.
- Only correctness, security, behavioral regression, and missing acceptance
  coverage can block completion; style is delegated to deterministic tooling.
- One remediation frontier per review.
- Reviewer step and wall-clock limits.

An optional `review-and-repair` mode can handle local, low-risk, mechanical
findings, but it should run in an isolated workspace, have a strict file
allowlist, and finish with deterministic verification rather than self-review.

## Parallel Scheduling

### Evidence from Existing Runs

The `msg_f744...` run already demonstrated effective parallel execution:

| Phase | Tasks | Summed worker time | Wall time | Effective speedup |
|---|---:|---:|---:|---:|
| Independent research | 14 | 82.75 min | 15.88 min | 5.21x |
| Independent corrections | 5 | 26.03 min | 13.64 min | 1.91x |

The task starts in each phase were within milliseconds of one another, so the
current OpenCode task mechanism can execute multiple tool calls concurrently in
one orchestrator turn. A new worktree system is not required to gain immediate
speedups for read-only tasks.

The flow prompt currently emphasizes `delegate the next unit`, singular, and a
completion loop. It does not instruct the orchestrator to identify and dispatch
an independent frontier.

### Recommended Scheduler: Dependency Frontiers

Represent a complex request as a small task graph. Each task needs:

- Stable task ID
- Objective and acceptance criterion
- Dependencies
- Read set or subsystem
- Expected write ownership
- Isolation mode
- Verification command or evidence
- Retry and time budget

At each scheduling step, dispatch every unblocked task up to the concurrency
limit. When the frontier completes, integrate its results, update dependencies,
and dispatch the next frontier.

This avoids two bad extremes:

- Fully serial execution, where the orchestrator waits on one worker while
  independent work remains.
- Unbounded fan-out, where many agents duplicate context, collide, and create a
  costly integration problem.

Start with three workers. Anthropic's current agent-team guidance recommends
three to five for most workflows, warns that token and coordination costs rise
with team size, and recommends parallelism only when tasks can operate
independently.

### Workspace Isolation Options

#### Shared Checkout

Use for:

- Read-only research and code exploration
- Independent review lenses
- Static analysis that does not mutate caches or generated files
- One writer plus read-only observers
- Very small writes with enforced, non-overlapping file ownership

Risks:

- Concurrent edits can overwrite or invalidate each other.
- Formatters, generators, lockfiles, and test snapshots often exceed the stated
  file scope.
- Tests can contend for ports, databases, Docker names, caches, and temporary
  files even when source files do not overlap.

Shared-checkout parallel writers therefore need technical write-set enforcement,
not only prompt instructions.

#### Isolated Git Worktrees

Use for:

- Two or more substantial implementation workers
- Tasks with separate modules but nontrivial tool use
- Experiments or competing implementations
- Changes whose tests mutate local state

Git worktrees provide separate files, `HEAD`, and index while sharing repository
objects. Claude Code now supports worktree-isolated subagents directly and
recommends them when parallel edits might collide.

Worktrees do not eliminate integration cost:

- Each writer needs a distinct branch or detached head.
- Dependencies and ignored environment files must be initialized.
- Ports, databases, Docker resources, and external services still need unique
  namespaces.
- Changes based on the same commit can conflict logically even when Git merges
  them textually.
- The integrated result must be tested again.
- A dirty parent checkout cannot be reproduced from `HEAD` without explicitly
  snapshotting its uncommitted state. The flow must never silently stash or
  commit user work.

For this plugin, worktree parallelism should be opt-in initially. If the parent
is dirty, either fall back to serial/shared-safe work, use a copy-on-write
snapshot mechanism, or ask the user to approve a checkpoint strategy.

#### Rift Copy-on-Write Snapshots

[Rift](https://github.com/anomalyco/rift) is not a wrapper around Git worktrees.
It snapshots an entire directory using writable btrfs snapshots, Linux per-file
reflinks, or APFS `clonefile`. In a Git repository, a created workspace has an
independent copied repository, detached `HEAD`, copied index, and copied working
tree.

This fits agent isolation particularly well:

- It preserves staged, unstaged, untracked, and non-excluded ignored files, so
  every worker can start from the user's exact dirty workspace state.
- Workers do not share branches, an index, or Git operation state.
- Copy-on-write creation is designed to be nearly instantaneous without
  duplicating unchanged file contents.
- A parent-child registry, subtree removal, trash, and garbage collection
  provide useful lifecycle primitives for an orchestration session.
- `.rift.toml` post-create hooks can restore omitted dependencies or run code
  generation.

Rift also changes the integration problem:

- Commits and refs made inside a Rift workspace are not automatically visible
  in the source repository because the entire `.git` directory was copied.
- A worker's `git diff HEAD` is not its task delta when the source was already
  dirty; it includes the inherited user changes as well.
- The orchestrator therefore needs an immutable session baseline and must
  compare each worker to that baseline, or create a disposable baseline commit
  inside each isolated copy before the worker starts.
- If the user modifies the source workspace while workers run, integration must
  compare current file hashes to baseline hashes and surface conflicts rather
  than overwrite newer user changes.

A safe Rift topology is:

```text
user workspace (may remain dirty and active)
  -> immutable session Rift
       -> worker Rift A
       -> worker Rift B
       -> worker Rift C
       -> integration Rift
```

Worker deltas are computed relative to the immutable session Rift, applied in
dependency order to the integration Rift, and verified there. Applying the
accepted integrated delta back to the user workspace is a separate guarded
operation.

Important constraints:

- The repository explicitly labels Rift experimental and not ready for use.
- Linux requires btrfs or a filesystem that supports native `FICLONE`
  reflinks; there is no full-copy fallback. macOS uses APFS. Windows workspace
  creation is not implemented.
- `rift init` can convert an ordinary btrfs directory into a subvolume and swap
  it into place. This one-time operation requires explicit user consent.
- Default creation omits dependencies, build products, and caches. Hooks can
  restore them, but hook execution should be disabled by default in unattended
  orchestration unless the project configuration is trusted.
- Rift refuses creation from linked Git worktrees and repositories with an
  active merge, rebase, cherry-pick, revert, bisect, lock, or inconsistent
  index.
- It does not isolate ports, databases, containers, credentials, or external
  services.
- Its Node API currently requires Node 26.1 experimental FFI. Calling the CLI
  is the less coupled initial integration.

On this machine, the repository filesystem reports `ext2/ext3` (normally the
Linux `statfs` label seen for ext4) and `rift` is not installed. That does not
meet Rift's documented Linux backends, so a local proof of concept would first
need a btrfs/XFS/reflink-capable storage location.

#### Comparison

| Property | Shared checkout | Git worktree | Rift snapshot |
|---|---|---|---|
| Dirty-state fidelity | Exact, live | Starts from commit | Exact snapshot |
| Writer isolation | Poor | Strong | Strong |
| Git refs/object store | Shared | Shared | Independent copy |
| Pre-existing dirty changes | No setup | Not reproduced | Preserved |
| Worker delta extraction | Easy only with disjoint ownership | Normal Git diff/commit | Requires baseline comparison |
| Parent changes during work | Immediate collision risk | Isolated | Isolated; guarded integration needed |
| Filesystem support | Universal | Git-supported | btrfs/reflink/APFS only |
| Maturity | N/A | Stable Git feature | Explicitly experimental |
| Dependencies/build state | Shared | Usually reinstalled/shared manually | Filtered by default; exact with `--copy-all` |

Recommended backend order:

1. Shared checkout for read-only work.
2. Rift for isolated writers when supported, explicitly enabled, and validated
   by a startup capability probe.
3. Git worktrees for clean committed bases where shared Git history simplifies
   integration.
4. Serial execution when no isolation backend can safely represent the current
   state.

### Central Integration

Do not let workers merge into the user's branch concurrently. Use a single
integrator that:

1. Captures each worker artifact and verification evidence.
2. Applies worker changes in dependency order to an integration workspace.
3. Detects textual and declared write-set conflicts.
4. Runs focused checks after each risky integration and one combined suite at
   the end.
5. Presents conflicts as explicit blockers rather than letting another agent
   guess across both implementations.

The artifact can be a temporary commit, patch, or snapshot diff. Worktree
commits enter the shared repository and therefore require explicit authority.
Rift permits disposable internal commits without changing the user's Git object
store, but the flow should still declare this behavior and must account for
untracked or ignored files omitted by Git. Baseline-to-worker snapshot diffs
avoid commit semantics but require a robust file-delta implementation.

### Avoid a Frontier Straggler

Parallel execution reduces summed latency to roughly the slowest task, but a
single 30-minute worker can still hold the whole frontier. Add:

- Per-task wall timeout in addition to agent-step limits
- Progress heartbeat or last-activity timestamp
- Cancellation and replacement after a bounded stall
- Partial collection so completed tasks can unlock downstream work without
  waiting for unrelated stragglers

The current synchronous task tool can launch a batch concurrently but resumes
the orchestrator only after the batch returns. Full dynamic scheduling would
benefit from background task handles and completion events; until those exist,
balanced frontier sizes and hard timeouts are the practical first step.

## Token and Cost Impact

Parallelism increases total worker tokens because each worker loads project
context and may duplicate exploration. Worktrees themselves do not consume
model tokens; coordination and duplicated context do.

Orchestrator usage can decrease despite higher worker usage:

- One decomposition turn replaces many serial routing turns.
- Workers return compact artifacts once instead of repeatedly growing root
  context.
- Independent results are synthesized in one pass.

It can also increase if every worker returns full transcripts or large diffs.
Control this with compact structured results, artifact paths or commit IDs,
strict task packets, and a small concurrency limit. The target metric should be
wall time and accepted work per orchestrator token, not minimum aggregate
tokens.

## Proposed Flow State Machine

```text
classify
  -> direct fast path, or build task graph
  -> dispatch ready frontier (max 3)
  -> integrate frontier
  -> repeat until implementation graph complete
  -> deterministic verification
  -> optional one-shot reviewer gate
  -> optional one remediation frontier
  -> deterministic final verification
  -> stop, or ask user on a concrete blocker
```

The state machine should enforce the limits. Prompt instructions should explain
how to choose tasks, but must not be the only loop control.

## Recommended Rollout

### Phase 1: Bound Review and Use Existing Parallelism

- Enforce reviewer triggers and sampling in code.
- Require compact reviewer packets.
- Deny reviewer mutation through both edit and shell paths.
- Cap normal runs at one review and one remediation frontier.
- Prompt the orchestrator to dispatch independent read-only and clearly
  disjoint tasks concurrently, maximum three.
- Add task, step, and wall-time limits.

This phase requires no worktree manager and addresses the observed failures
directly.

### Phase 2: Add Observable Frontier Scheduling

- Add stable task IDs and dependency edges.
- Record ready time, queue time, execution time, concurrency, critical-path
  time, and integration time.
- Compare serial-equivalent duration with wall duration.
- Add partial-result and straggler handling if OpenCode's task API permits it.

### Phase 3: Opt-In Isolated Writers

- Define a common isolation backend interface: create, execute, diff, integrate,
  remove, and garbage-collect.
- Prototype Rift first on a supported filesystem, with a capability probe and
  explicit experimental opt-in.
- Keep Git worktrees as the clean-base backend and fallback.
- Require a clean parent for worktrees; use a session snapshot for dirty Rift
  sources.
- Enforce write ownership and isolated runtime namespaces.
- Integrate centrally and run combined verification.
- Start with two parallel writers; raise to three only after measuring merge and
  rework rates.

## Success Criteria

- Reviewer policy configuration changes actual runtime routing.
- No normal run invokes reviewer more than once.
- No review finding can cause more than one remediation frontier.
- Reviewer receives acceptance criteria, bounded diff evidence, and verification
  results without repository rediscovery.
- Eligible read-only phases show at least 2x median wall-clock speedup.
- Parallel writers never share a working directory, index, or mutable branch.
- Dirty source state is preserved exactly or the flow refuses parallel writes.
- Applying an isolated result cannot overwrite a source file changed since the
  session baseline.
- Integration conflicts are surfaced, not silently resolved.
- Final integrated verification runs exactly once after all accepted repairs.
- Reports separate worker sum time, critical-path time, review time, remediation
  time, and integration time.

## Sources

1. Local run telemetry under `~/.local/state/opencode-agent-flows/runs/`.
2. `src/flows/openai-commandcode-router.ts`, `plugin.ts`, and
   `docs/FEATURES.md` in this repository.
3. Anthropic, "Building effective agents": parallel sectioning,
   orchestrator-workers, evaluator-optimizer fit, and stopping conditions.
   https://www.anthropic.com/engineering/building-effective-agents
4. Claude Code, "Best practices": writer/reviewer separation, warning against
   chasing every reviewer finding, context management, and parallel sessions.
   https://code.claude.com/docs/en/best-practices
5. Claude Code, "Agent teams": independence requirements, token overhead,
   recommended team size, write-conflict warnings, and task dependencies.
   https://code.claude.com/docs/en/agent-teams
6. Claude Code, "Worktrees": isolated subagents, environment setup, cleanup,
   and worktree base behavior.
   https://code.claude.com/docs/en/worktrees
7. Vercel AI SDK, "Workflow patterns": explicit parallel processing with
   `Promise.all`, orchestrator-worker structure, and bounded evaluator loops.
   https://ai-sdk.dev/docs/agents/workflows
8. Git, `git-worktree`: per-worktree files, shared refs, branch safeguards, and
   cleanup behavior.
   https://git-scm.com/docs/git-worktree
9. Anomaly, Rift README: copy-on-write backends, CLI lifecycle, Git-state
   preservation, hooks, and experimental status.
   https://github.com/anomalyco/rift
10. Anomaly, Rift specification: exact dirty-state semantics, refusal cases,
    registry model, Git integration, and absence of a full-copy fallback.
    https://github.com/anomalyco/rift/blob/dev/specs.md
