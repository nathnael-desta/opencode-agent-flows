# Delegation and Work-Packet Patterns for Coding-Agent Orchestrators

Research report: primary-source patterns for bounded task handoff with
evidence-based correction. Focus on what can be implemented in the
`opencode-agent-flows` router without upstream changes.

## 1. Primary-Source Patterns

### 1.1 OpenAI Agents SDK: Gated Handoffs with Artifact Checks

The Agents SDK defines handoff as a full-context transfer where the receiving
agent retains the prior conversation. The project-manager example enforces
**file-existence gates**: the orchestrator must verify that a required artifact
exists before advancing to the next handoff (OpenAI Cookbook, "Building
Consistent Workflows with Codex CLI Agents SDK").

```python
# Do not advance to the next handoff until the required files for that step
# are present. If something is missing, request the owning agent to supply it
# and re-check.
```

The SDK also supports `InputGuardrail` and `OutputGuardrail` with a
`tripwire_triggered` boolean that can block generation or reject output. These
are code-level enforcement, not prompt suggestions (OpenAI Developers,
"Guardrails & Approvals").

**Relevant to our router:** The orchestrator prompt already says "inspect its
result" but has no structured artifact-existence check. The SDK pattern
demonstrates that the orchestrator should hold a checklist of expected output
shapes (diff present, tests pass, verification evidence returned) and refuse to
advance until each item is verified—encoded as tool-level logic, not prompt
text.

### 1.2 OpenAI Agents SDK: Structured Output Contracts

Agents can declare `output_type` (Pydantic/Zod schema) so the runtime
validates the agent's final output against a schema before it propagates. This
converts a free-text response into a typed contract (OpenAI Developers,
"Define Agents").

**Relevant to our router:** Worker agents currently return free text. A
structured output contract—e.g., `{files_changed: string[], tests_ran: string[],
verification_passed: boolean, evidence: string}`—would let the orchestrator
programmatically inspect results rather than relying on the LLM to self-report.

### 1.3 OpenCode: Default-Deny Subagent Permissions

OpenCode's `deriveSubagentSessionPermission` function explicitly denies
`task` and `todowrite` for spawned subagents unless the agent definition
overrides this (OpenCode source, `subagent-permissions.ts`). This is a
**technical boundary**, not a prompt instruction.

OpenCode's task tool also walks the parent session chain and enforces a
configurable `subagent_depth` limit (default: 1), preventing unbounded
recursion at the runtime level (OpenCode source, `tool/task.ts`).

**Relevant to our router:** The plugin already uses OpenCode's permission
system for evaluator agents (`permission: { edit: "deny", bash: "deny", task:
"deny" }`). This pattern can be extended: worker agents should deny `task` to
prevent delegation chains, and bulk workers should additionally deny tools
outside their scope.

### 1.4 Anthropic: Tool-Choice Constraints and Structured Output

Anthropic's SDK supports `disable_parallel_tool_use` on `tool_choice` to
enforce single-tool-at-a-time execution, and `output_format` with Pydantic
models for structured JSON enforcement (Anthropic SDK, `tool_choice_param`,
`structured_outputs.py`).

**Relevant to our router:** When a worker is given a bounded task, constraining
it to single-tool execution (or enforcing a specific tool sequence) reduces the
space for scope creep. This is complementary to prompt instructions.

### 1.5 OpenAI Agents SDK: Guardrail Boundaries

OpenAI's documentation explicitly states: "input guardrails run only for the
first agent, and output guardrails only for the agent producing the final
output. Tool guardrails are attached to their respective function tools... place
validation directly next to the tool creating the side effect" (OpenAI
Developers, "Guardrails & Approvals").

**Relevant to our router:** The current plugin places guardrails in
`tool.execute.before` hooks, which is the correct location. However, guardrails
are currently path-based only. Output guardrails (validating the worker's
response shape) are missing.

## 2. Limitations of Prompt-Only Enforcement

The router already documents this: "Cross-family review selection is
prompt-enforced; user agent overrides can make an independent model unavailable"
(`openai-commandcode-router.ts:121`). But the limitation extends beyond review
selection:

| Prompt instruction | Failure mode |
|---|---|
| "Delegate bounded routine work to routine" | Model delegates unrelated work to save subscription tokens |
| "Do not escalate merely because a task is long" | Model escalates anyway when the prompt context is large |
| "Inspect result, resolve failures, delegate next unit" | Model relays the subagent result without verification |
| "Use deep only after routine exhausts bounded retries" | Model uses deep immediately for convenience |
| "Reviewer must be different model family" | User overrides make the only available family the same |

**Core problem:** Prompt text is advisory. It influences probability but cannot
prevent an action. The plugin already has technical boundaries for:

- Approval-gated escalation (`flow_approve_escalation` tool, consumed once)
- Protected path enforcement (`tool.execute.before` hook)
- Evaluator read-only enforcement (tool deny in hook)
- Worker attempt limits (counted in `taskAttempts` map)

These are the patterns that hold. Prompt text is best used for routing
heuristics and quality guidance, not as the enforcement layer for safety or
scope constraints.

## 3. Recommended Improvements

### 3.1 Structured Work-Packet Schema for Workers

**What:** Define a Zod/TypeScript schema that workers must return. Example:

```typescript
interface WorkPacket {
  files_changed: string[]       // Files modified
  summary: string               // What was done
  tests_ran: string[]           // Verification commands executed
  tests_passed: boolean         // Whether all passed
  evidence: string              // Tool output or diff excerpt
  blocked: boolean              // Whether work is incomplete
  blocker?: string              // Why work is blocked
}
```

**Why:** Converts free-text worker output into a typed object the orchestrator
can inspect programmatically. The OpenAI SDK's `output_type` pattern
demonstrates this works at the schema level.

**Where:** Add to `FlowDefinition` as a `workerOutputSchema` field. Parse
worker output in `tool.execute.after` and attach to the `TaskTrace`.

**Source:** OpenAI Agents SDK structured outputs; OpenAI Cookbook, "Define
Agents."

### 3.2 Orchestrator Artifact-Check Enforcement

**What:** After each worker delegation, the orchestrator should verify
concrete artifacts before advancing. Add a `requiredArtifacts` field to the
flow definition and enforce it in `tool.execute.before`:

```typescript
// Pseudocode for tool.execute.before
if (task.status === "completed" && flow.requiredArtifacts) {
  for (const artifact of flow.requiredArtifacts) {
    if (!artifact.exists(task)) {
      // Re-inject a correction instruction into the orchestrator
    }
  }
}
```

**Why:** The OpenAI cookbook's project-manager pattern gates handoffs on
file-existence checks. Without this, the orchestrator trusts the worker's
self-report.

**Where:** Extend `VerificationPolicy` with `requiredArtifacts` or add a
post-delegation hook in `tool.execute.after`.

**Source:** OpenAI Cookbook, "Building Consistent Workflows with Codex CLI
Agents SDK" gated handoffs.

### 3.3 Output Guardrail for Worker Responses

**What:** Add an output guardrail that validates worker responses match the
work-packet schema. If the response is malformed, inject a correction
instruction and retry (bounded by `maxWorkerAttempts`).

**Why:** OpenAI's guardrails documentation recommends placing validation
"directly next to the tool creating the side effect." The plugin already
intercepts tool output in `tool.execute.after`; adding schema validation here
is the natural location.

**Where:** In `tool.execute.after`, when `task.status === "completed"`, parse
the output against the work-packet schema. On failure, set `task.status` to
`needs-correction` and re-inject context.

**Source:** OpenAI Developers, "Guardrails & Approvals"; Anthropic SDK
structured output enforcement.

### 3.4 Per-Agent Tool Permission Profiles

**What:** Declare explicit permission profiles for each agent role in the flow
definition, beyond what OpenCode's default-deny already provides:

```typescript
interface AgentPermissionProfile {
  role: AgentRole
  allowedTools: string[]
  deniedTools: string[]
  maxToolCalls?: number          // Scope boundary
}
```

Bulk workers get a narrow allowlist (read, write, glob, grep). Reviewers get
read-only. Workers get a broader set but with `task` denied to prevent
recursive delegation. This is already partially implemented for evaluators but
not for production agents.

**Why:** OpenCode's `deriveSubagentSessionPermission` already denies `task`
and `todowrite` by default. Making this explicit and per-role in the flow
definition prevents prompt-only scope creep.

**Where:** Extend `AgentDefinition` with a `permission` field that the plugin
merges into the OpenCode agent config at startup.

**Source:** OpenCode source, `subagent-permissions.ts`, `agent.ts` (built-in
subagent permission profiles).

### 3.5 Correction Loop with Bounded Context Injection

**What:** When a worker returns a failing verification or incomplete work
packet, the orchestrator should inject a bounded correction context:
the specific failure, the relevant diff, and the verification evidence—not the
full repository. This is already described in the orchestrator prompt but
enforced only by prompt text.

Implement as a `correctionContext` builder that runs in `tool.execute.before`
on retry:

```typescript
if (attempt > 0 && previousTask) {
  const correction = buildCorrectionContext(previousTask, verification)
  // Inject into the task description
}
```

**Why:** The OpenAI SDK's bounded retry pattern and the orchestrator prompt's
"pass the specific blocker, final diff, and verification evidence so it
diagnoses the residue rather than repeats the worker's exploration" describe
the same idea. Making it structural (computed from task state, not prompt
instruction) prevents the model from sending the wrong context.

**Where:** In `tool.execute.before` when `taskAttempts.get(key) > 0`, build
the correction packet from the previous `TaskTrace` and `VerificationEvidence`.

**Source:** Orchestrator prompt (`openai-commandcode-router.ts:21`); OpenAI
Cookbook bounded delegation patterns.

### 3.6 Scope-Contract Enforcement via Task Description Hashing

**What:** Hash the original task description at delegation time. On
verification, compare the worker's output scope (files changed, claims made)
against the original scope contract. If the worker claims to have modified
files outside the declared scope, flag it as scope creep in the run report.

**Why:** Prompt-only "delegate bounded work" cannot prevent a worker from
touching unlisted files. This adds telemetry-visible evidence of scope
violation without blocking (defense in depth, matching the plugin's existing
"fail open" telemetry philosophy).

**Where:** In `tool.execute.after`, compare `workPacket.files_changed` against
the task description's implied scope. Record a `ScopeViolation` quality
evidence item.

**Source:** Plugin architecture's "Enforcement Boundaries" section
(`architecture.md:147`); OpenAI guardrails documentation on tool-level
validation.

## 4. Summary Table

| # | Improvement | Enforcement layer | Prompt-only? | Complexity |
|---|---|---|---|---|
| 3.1 | Structured work-packet schema | Output contract | No | Medium |
| 3.2 | Artifact-check enforcement | Post-delegation hook | No | Medium |
| 3.3 | Output guardrail for workers | Tool output validation | No | Low |
| 3.4 | Per-agent tool permission profiles | Agent config merge | No | Low |
| 3.5 | Correction loop with context injection | Pre-delegation hook | Partial | Medium |
| 3.6 | Scope-contract hashing | Telemetry evidence | No | Low |

## Sources

1. [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
   — input, output, and tool guardrails should be enforced at the runtime
   boundary.
2. [OpenAI Agents SDK: Agents](https://openai.github.io/openai-agents-js/guides/agents/)
   — structured output contracts and agent configuration.
3. [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
   — route well-defined work to specialized workers, use environmental ground
   truth, and bound agent iterations.
4. [OpenCode: Agents and permissions](https://opencode.ai/docs/agents/)
   — per-agent tool and task permissions, plus bounded agent steps.
5. Plugin source, `architecture.md` — prompt guidance is advisory; tool hooks
   provide the enforceable boundary.
