# Architecture And Manual Customization

## Repository Boundaries

`opencode-commandcode-provider` is a provider adapter. It authenticates with
Command Code, discovers its model catalog, converts OpenCode requests into the
Command Code request shape, and parses streaming responses.

`opencode-agent-flows` is policy. It chooses agents, providers, models,
reasoning variants, delegation rules, and escalation behavior. It does not
send model requests or hold credentials.

Keeping these concerns separate allows provider fixes to ship without changing
your workflow and allows new workflows to reuse the same provider.

The plugin itself is also separated from individual flows. Shared telemetry,
reporting, quota, quality, verification, guardrail, and dashboard behavior
reads declarative flow metadata rather than model names.

## Request Flow

1. OpenCode merges global and project configuration.
2. Provider plugins register providers and models.
3. This plugin's `config` hook adds the selected flow's agents.
4. The primary orchestrator receives the user request on ChatGPT Sol low.
5. It either handles the request or delegates to a named subagent.
6. The subagent makes a separate request through its configured provider.
7. Plugin hooks record the root turn, task calls, verification, model usage,
   costs, child sessions, quality evidence, and quota snapshots.
8. Root idle materializes run, session, and global reports.

For example, delegating to `routine` sends the task through Command Code to
DeepSeek V4 Pro. Delegating to `deep` sends it through the native OpenAI
provider covered by the ChatGPT subscription.

## Model Names Versus Variants

`openai/gpt-5.6-luna-pro` and `openai/gpt-5.6-sol-pro` are model IDs exposed by
OpenCode's native OpenAI provider. `low`, `medium`, and `high` are reasoning
variants selected with the separate `variant` field.

Command Code's public catalog currently exposes Luna, Terra, and Sol but not
their `-pro` IDs. Their presence in the provider fork means they are selectable
through Command Code; it does not mean this flow routes GPT usage there.

## Manual Changes

Edit `src/flows/openai-commandcode-router.ts`:

- Change `model` to move an agent to another provider.
- Change `variant` to adjust reasoning effort.
- Change `mode` to make an agent primary, subagent-only, or both.
- Edit the orchestrator prompt to alter delegation and approval policy.
- Add another agent by adding another key to `agents`.

Keep provider prefixes explicit. `openai/...` consumes the ChatGPT/OpenAI
connection; `commandcode/...` consumes Command Code credits.

## Plugin Modules

```text
plugin.ts
  Composition root, OpenCode hooks, tools, enforcement, and run lifecycle

src/flows/
  Declarative agents, semantic roles, billing sources, routing, verification,
  escalation, reviewer behavior, and documentation inputs

src/telemetry/types.ts
  Versioned runtime and report contracts

src/telemetry/reports.ts
  Pure run, session, and global reducers

src/telemetry/store.ts
  Atomic report materialization and global rebuilding

src/telemetry/markdown.ts
  Cross-client Markdown reports

src/telemetry/dashboard.ts
  Self-contained browser dashboard

src/telemetry/quota.ts
  Codex provider quota and local Command Code budget adapters

scripts/generate-docs.ts
  Flow-definition to Markdown/Mermaid generator
```

## Semantic Separation

The architecture keeps four different concepts separate:

| Concept | Source |
|---|---|
| Agent role | Flow metadata |
| Delegation | Root/child sessions and task calls |
| Billing source | Flow metadata |
| Actual model/provider | OpenCode message telemetry |

This is why a future flow may delegate to another OpenAI model without being
misclassified as orchestrator work, or use a non-OpenAI baseline without
changing the reporting engine.

## Run Identity

OpenCode sessions contain multiple user turns and do not expose a run object.
The plugin creates a run from the root `chat.message` message ID. Subsequent
tool and task activity is associated with the active run. A root idle event
closes and materializes it. Child idle events do not close the root run.

The session report is rebuilt from the root and recursively collected child
sessions, so it includes all runs. Global state is rebuilt from immutable run
reports rather than incrementally mutating counters, reducing lost-update risk.

## Task Confidence

OpenCode currently exposes a task call and child sessions but no guaranteed
foreign key between them. The plugin records the call ID exactly and labels
child linkage as correlated. Reports must not present this as exact until the
runtime exposes a durable relationship.

## Evaluation Isolation

Developer evaluators use the baseline agent's configured model and are marked
with the `evaluator` role. Their usage and cost remain visible but are excluded
from production displacement calculations. Evaluator prompts are read-only and
must return structured evidence. Evaluation failure cannot fail production
work.

## Quota Sources

Codex is an optional provider-reported adapter. It uses the documented app
server protocol instead of scraping terminal output. Command Code is currently
a local budget adapter based on observed response costs and a configured
allowance. These confidence levels are retained in reports.

## Persistence And Privacy

Summaries are written to a user-state directory with temporary-file plus rename
replacement. The plugin persists normalized counts and metadata, not prompts,
tool outputs, source diffs, credentials, or authorization headers. Dashboard
HTML has no external dependencies.

## Enforcement Boundaries

Telemetry and optional integrations fail open. Escalation approval,
protected-path rules, work-packet input validation, and worker delegation
permissions fail closed. Structured worker-report validation emits a visible
guardrail warning rather than silently accepting malformed evidence. Prompt
guidance improves model behavior, while tool hooks enforce the boundaries that
must not be advisory.

## Precedence

The plugin uses `??=` when adding agents and setting the default. A user-defined
agent with the same name wins. This makes local overrides possible without
forking the flow repository, while still allowing a fork for larger changes.
