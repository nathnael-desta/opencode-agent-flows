# Milestone review

Review is a **milestone gate, not a per-commit gate**. Reviewing every commit
with a model is expensive, slow, and trains everyone to ignore the output. The
cheap deterministic checks — lint, types, focused tests, integrated tests — are
the incremental gate. Model review is saved for substantial, self-contained
changesets.

## When review runs

- You explicitly ask for it.
- Before work leaves your hands.
- A substantial sampled changeset is selected (`reviewer.sampleRate`).
- Immediately after a self-contained **security, authorization, money, secrets,
  data-integrity, destructive-lifecycle, or migration** unit.

Routine UI, copy, docs, config, and low-risk refactors are **not** separately
reviewed.

## The review packet

The orchestrator sends a compact packet with exactly these sections:

```text
# Review Milestone:   what this milestone is
# Acceptance:         the criteria to judge against
# Change Set:         the diff and relevant snippets
# Verification:       what was run and what passed
# Risk:               low | standard | high
```

Packets are capped (`reviewer.maxPacketChars`, default 12,000).

## Reviewer output

The reviewer returns structured JSON in a `<flow-review>` block, capped at
**five evidence-backed findings**.

Findings that deterministic tooling already covers — style, formatting, anything
lint or types catch — are **non-blocking**. A reviewer that spends its five
findings on formatting has wasted the gate.

Every finding must be triaged:

- **Agree** → fix it now, or
- **Disagree** → record a one-line reason.

Silently ignoring a finding is not an option.

## Round limits

| Round | Allowed when |
|---|---|
| 1 | Normal — this is the expected case |
| 2 | Only after a changes-requested verdict, recorded finding disposition, **and** non-trivial fixes |
| 3 | Never — hard rejection |

The second packet must include `Finding Disposition` and `Non-trivial Fixes`.

## Reviewer isolation

The reviewer is technically prevented from editing files, running shell
commands, delegating tasks, or mutating state — not merely instructed not to:

```ts
permission: { edit: "deny", bash: "deny", task: "deny", todowrite: "deny" }
```

## Independence

Prefer a reviewer from a **different model family** than the implementation
worker. A reviewer sharing the implementer's blind spots is not independent
review.

> [!NOTE]
> Cross-family selection is prompt-enforced. If your model bindings leave no
> independent family available, the orchestrator must **disclose** that rather
> than quietly reviewing with the same family.

## When review is unavailable

If the reviewer returns nothing or malformed output, the orchestrator must
**disclose it** and perform one careful diff self-review instead. It must not:

- silently skip the gate, or
- retry purely to fix output formatting.

This is a real scenario: during development, both configured cross-family
reviewer calls returned empty output, so review availability was disclosed and a
bounded diff self-review was substituted.

## Configuration

```json
{
  "reviewer": {
    "enabled": true,
    "agent": "reviewer",
    "sampleRate": 0.1,
    "maxRounds": 2,
    "maxFindings": 5,
    "maxPacketChars": 12000
  }
}
```

Model review is **evidence, not ground truth**.
