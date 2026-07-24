# OpenCode Agent Flows

Version-controlled, shareable agentic flows for OpenCode. Provider adapters
stay in their own repositories; this project only decides which agent uses
which provider, model, and reasoning effort.

## OpenAI + Command Code Router

The included flow combines:

- A ChatGPT Plus/Pro subscription for GPT models through OpenCode's native
  `openai` provider.
- A $1.36 Command Code subscription with $40 in monthly credits for open-source
  models through the separate Command Code provider fork.

| Role | Provider/model | Effort |
|---|---|---|
| Orchestrator | `openai/gpt-5.6-sol` | low |
| Repetitive bulk work | `commandcode/mimo-v2.5` | default |
| Routine and fast path | `commandcode/deepseek-v4-pro` | high |
| Cheap independent review | `commandcode/mimo-v2.5-pro` | default |
| Deep escalation | `openai/gpt-5.6-terra` | high |
| Approved escalation | `openai/gpt-5.6-sol` | medium or high |

DeepSeek V4 Pro is the routine default through Command Code. The frontier
subscription remains available for GPT-5.6 Sol orchestration and targeted
GPT-5.6 Terra escalation only after a bounded worker failure or for work whose
risk makes cheap-first routing inappropriate.

MiMo V2.5 handles repetitive, low-risk, token-heavy transformations, while
MiMo V2.5 Pro independently reviews selected DeepSeek changes. This preserves
the ChatGPT subscription for Sol orchestration and Terra escalation.

## Install

```bash
git clone https://github.com/nathnael-desta/opencode-agent-flows.git
```

Add the local plugin to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    [
      "file:///absolute/path/to/opencode-agent-flows/plugin.ts",
      { "flow": "openai-commandcode-router", "setDefault": true }
    ]
  ]
}
```

See [`examples/opencode.jsonc`](examples/opencode.jsonc) for the complete
two-provider setup. Restart OpenCode and T3 Code after changing configuration.

### 6. Configure Published Packages

Once both packages are published, replace the local file URLs with pinned npm
versions:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-commandcode-provider@0.1.0",
    [
      "opencode-agent-flows@0.1.0",
      { "flow": "openai-commandcode-router", "setDefault": true }
    ]
  ],
  "provider": {
    "commandcode": {
      "npm": "opencode-commandcode-provider@0.1.0",
      "name": "Command Code",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

Pinned versions make upgrades explicit. Restart OpenCode and T3 Code after
changing the configuration.

## Authentication

For ChatGPT, run `/connect`, select **OpenAI**, and choose **ChatGPT
Plus/Pro**. This uses the subscription rather than OpenAI API billing.

For Command Code, install the provider fork, run `/connect`, select **Command
Code**, and enter its API key. T3 Code starts `opencode serve` directly, so do
not rely on a shell alias to inject that key.

## How It Works

OpenCode loads `plugin.ts` at startup and calls its `config` hook. The plugin:

1. Selects a named flow from `src/flows/index.ts`.
2. Adds that flow's agents to the merged OpenCode configuration.
3. Preserves agents you already defined with the same names.
4. Sets the flow's primary agent only when no default is already configured.

The orchestrator is a normal primary OpenCode agent. Its prompt tells it when
to delegate through OpenCode's task tool. A delegated subagent performs its own
model call; Sol low chooses the worker but does not simulate the worker's
reasoning. The orchestrator dispatches independent units as a bounded frontier,
integrates them, and continues only within hard task, concurrency, retry,
review, and agent-step limits. This is OpenCode's normal in-session tool loop,
not an unbounded external process that restarts failed sessions forever.

The plugin enforces medium/high escalation with a one-use OpenCode permission
prompt. Worker tool calls also have protected-path guardrails for sensitive
areas such as authentication, billing, infrastructure, and migrations.

Routine delegations accept a concise free-form packet. The plugin caps it at
3,000 characters and directs the orchestrator to describe
observable outcomes and subsystem boundaries rather than inspect files or
produce a detailed implementation plan. Repository exploration, file selection,
and implementation design belong to the economical worker. The plugin
appends a worker contract that permits correcting inaccurate file assumptions
from repository evidence, but prohibits silently broadening the requested
behavior. Workers must return a structured report with changed files,
verification, scope changes, and blockers. Malformed reports become explicit
invalid-output failures and cannot trigger a separate model task merely to
repair formatting.

Review is a milestone gate, not a per-commit gate. MiMo V2.5 Pro reviews one
compact accumulated changeset after deterministic checks, with a normal limit
of one round and a hard ceiling of two rounds after non-trivial fixes.

Optional Rift integration gives concurrent writers copy-on-write snapshots of
the exact dirty workspace. A central integration step rejects undeclared files,
worker conflicts, and source files changed after the baseline. Rift remains
experimental and must be enabled explicitly on a supported filesystem.

Deep escalation is technically cheap-first: architecture and other high-risk
work goes to the routine worker with strict stop conditions. The plugin rejects
Deep unless the current run already contains a failed or blocked routine result,
and every Deep call requires explicit one-use user approval.

## Release

`make check` runs the complete validation suite and previews the npm package.
After committing the intended work on `main`, run `make release VERSION=patch`.
It verifies a clean, up-to-date branch, bumps the version, validates again,
commits the version bump, tags it, pushes the source and tag, then publishes to
npm. It stops on the first failed command; it never stages uncommitted feature
work.

## Usage Reports

The plugin distinguishes one root turn (a run), the whole OpenCode conversation
tree (a session), and every persisted run (global). Reports include models,
providers, billing sources, subagent counts, task outcomes, verification,
quality evidence, quota snapshots, costs, and estimated baseline displacement.

The default outputs are:

```text
~/.local/state/opencode-agent-flows/latest-run.md
~/.local/state/opencode-agent-flows/latest-session.md
~/.local/state/opencode-agent-flows/global.md
~/.local/state/opencode-agent-flows/dashboard.html
```

After each completed run, an optional toast shows its subagent count, estimated
savings, and metered cost. The `flow_status` tool provides run, session, and
global Markdown in any OpenCode client. `flow_dashboard` returns the
self-contained browser dashboard path, making the UI usable from T3 Code, the
TUI, desktop clients, and normal browsers.

The estimator is model-independent. Flows declare semantic agent roles, billing
sources, and a baseline agent; runtime reports preserve the actual provider and
model. Capacity remains an estimate because subscription limits are not
token-metered.

## Model Overrides

`flow_models` lists the effective model mapping. To change it from an OpenCode
conversation, ask the orchestrator to change an agent or invoke the tool with
an agent and `provider/model` value, such as
`commandcode/laguna-s-2.1-free`. The override is saved at
`~/.local/state/opencode-agent-flows/model-overrides.json`; restart OpenCode to
apply it. Omitting a variant clears the default variant for the new model. Use
`reset: true` with an agent to return to the model shipped by the flow.

An override can select only a model already available through an OpenCode
provider. Adding a new provider or model catalog still belongs in
`opencode.json`.

Useful configuration:

```json
[
  "file:///absolute/path/to/opencode-agent-flows/plugin.ts",
  {
    "flow": "openai-commandcode-router",
    "setDefault": true,
    "telemetry": {
      "enabled": true,
      "runSummaryToast": true,
      "displacementEfficiency": 0.75
    },
    "quota": {
      "codex": true,
      "commandCodeMonthlyCreditsUsd": 40
    }
  }
]
```

Codex quota uses the documented app-server `account/rateLimits/read` method.
Command Code uses exact observed request cost against a configured local
allowance until a documented account-balance endpoint exists.

See:

- [`docs/FEATURES.md`](docs/FEATURES.md) for every shared capability.
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for all options.
- [`docs/MANUAL-TESTING.md`](docs/MANUAL-TESTING.md) for the end-to-end checklist.
- [`docs/flows/openai-commandcode-router.md`](docs/flows/openai-commandcode-router.md)
  for the generated simple and detailed flow diagrams.

## Add A Flow

1. Copy `src/flows/openai-commandcode-router.ts` to a new file.
2. Give every agent a unique name, model, mode, and concise responsibility.
3. Export the flow from `src/flows/index.ts` under a new key.
4. Add semantic agent metadata, routing, verification, reviewer, and limitation
   declarations.
5. Run `bun run docs` to generate its Markdown and Mermaid diagrams.
6. Add tests asserting provider boundaries and escalation behavior.
7. Select it with `{ "flow": "your-flow" }` in the plugin tuple.

See [`docs/architecture.md`](docs/architecture.md) for the data flow and
customization rules.

## Development

```bash
bun install
bun run verify
```
