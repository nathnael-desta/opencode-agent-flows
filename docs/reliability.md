# Reliability and budgets

Agentic loops fail in predictable ways: they run forever, retry the same broken
thing, silently treat a missing result as success, or fan out until they trip
rate limits. These limits are **structurally enforced in the plugin**, not left
to prompt wording.

## Hard budgets

| Budget | Default | Why |
|---|---|---|
| Orchestrator agent steps | 30 | Bounds the routing loop |
| Routine / deep steps | 24 | Bounds a worker |
| Reviewer / bulk steps | 12 | These jobs are narrow |
| Escalation steps | 30 | Escalation still terminates |
| Tasks per run | 12 | Caps total delegation per root turn |
| Concurrent workers | 3 | Avoids rate-limit storms |
| Worker attempts | 2 | Stops retry loops |

Tune the run-level ones:

```json
{ "orchestration": { "maxTasksPerRun": 12, "maxConcurrentWorkers": 3 } }
```

## Stable Task IDs

Every delegation carries a Task ID that is reused across retries and
remediation. This matters more than it sounds:

- Rewording a retry cannot reset its attempt count, so a worker cannot get
  infinite attempts by being asked slightly differently each time.
- Duplicate concurrent attempts for the same Task ID are rejected.

## Explicit task states

A task is `running`, `completed`, `blocked`, `failed`, or `invalid-output`.
The distinctions are deliberate:

- **Missing or malformed work reports become failures**, never silent successes.
  A worker that returns nothing has failed.
- **Empty worker output is a failure.**
- **`invalid-output` is tracked separately** from ordinary failure, so a
  formatting problem is never mistaken for a substantive one.

> [!IMPORTANT]
> A report-formatting error can **never** spawn a dedicated correction worker.
> Paying for a model call just to fix a missing tag is waste; the orchestrator
> handles it directly.

Invalid formatting also does **not** count as evidence for deep escalation.

## Provider errors

Child-session provider errors — including quota messages — are persisted,
correlated back to the delegating task, and returned to the orchestrator instead
of vanishing into a child session. Provider errors that carry no token usage are
still counted in telemetry, so failures are visible rather than free.

## Parallel scheduling

Orchestration uses **dependency frontiers** rather than a serial loop: build a
small dependency graph, dispatch independent units concurrently up to the
concurrency limit, integrate the completed frontier, then dispatch the next.

Read-only or rigorously disjoint units may run together. Dependent or
overlapping writes stay serial.

## Cheap-first escalation

Escalation is a technical gate, not a suggestion:

1. High-risk work still goes to `routine` first, with explicit stop conditions.
2. `deep` is rejected unless the run already holds a concrete failed or blocked
   routine result.
3. Every `deep` and `extreme-*` call needs a one-use approval token from
   `flow_approve_escalation`.

Length or file count is explicitly **not** grounds for escalation.

## Guardrails

Protected paths use **segment-aware** matching, so `translations.py` no longer
falsely matches a rule meant for `auth`. Workers may read protected files but
cannot mutate them.

```json
{
  "guardrails": {
    "enabled": true,
    "protectedPaths": [".env", "**/auth/**", "**/billing/**", "**/infrastructure/**", "**/migrations/**"]
  }
}
```

Defaults cover `.env` variants plus authentication, billing, infrastructure, and
migration paths.

## Known boundaries

- OpenCode's hook API exposes no true background completion handle and no
  general wall-clock cancellation. Step, task, retry, concurrency, and review
  budgets are enforced instead.
- Subscription capacity is not token-metered, so savings are estimated.
- Task-to-child-session linkage is correlated when OpenCode exposes no explicit
  identifier.
