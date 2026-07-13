# OpenCode Agent Flows

Version-controlled, shareable agentic flows for OpenCode. Provider adapters
stay in their own repositories; this project only decides which agent uses
which provider, model, and reasoning effort.

## Best Of Both Worlds

The included flow combines:

- A ChatGPT Plus/Pro subscription for GPT models through OpenCode's native
  `openai` provider.
- A $1 Command Code Go subscription for permanently discounted open-source
  models through the separate Command Code provider fork.

| Role | Provider/model | Effort |
|---|---|---|
| Orchestrator | `openai/gpt-5.6-sol` | low |
| Routine and fast path | `commandcode/deepseek-v4-pro` | high |
| Deep work | `openai/gpt-5.6-sol` | low |
| Approved escalation | `openai/gpt-5.6-sol` | medium or high |

DeepSeek V4 Pro replaces Flash in the routine path because its 75% Command
Code discount is permanent. Temporary promotions are not used for defaults.

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
      { "flow": "best-of-both-worlds", "setDefault": true }
    ]
  ]
}
```

See [`examples/opencode.jsonc`](examples/opencode.jsonc) for the complete
two-provider setup. Restart OpenCode and T3 Code after changing configuration.

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
reasoning.

The medium/high approval boundary is prompt-enforced, not a hard billing
firewall. Remove those agents or tighten their permissions if you require a
strict technical boundary.

## Add A Flow

1. Copy `src/flows/best-of-both-worlds.ts` to a new file.
2. Give every agent a unique name, model, mode, and concise responsibility.
3. Export the flow from `src/flows/index.ts` under a new key.
4. Add tests asserting provider boundaries and escalation behavior.
5. Select it with `{ "flow": "your-flow" }` in the plugin tuple.

See [`docs/architecture.md`](docs/architecture.md) for the data flow and
customization rules.

## Development

```bash
bun install
bun test
bun run typecheck
```
