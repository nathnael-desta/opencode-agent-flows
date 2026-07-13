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

## Request Flow

1. OpenCode merges global and project configuration.
2. Provider plugins register providers and models.
3. This plugin's `config` hook adds the selected flow's agents.
4. The primary orchestrator receives the user request on ChatGPT Sol low.
5. It either handles the request or delegates to a named subagent.
6. The subagent makes a separate request through its configured provider.

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

Edit `src/flows/best-of-both-worlds.ts`:

- Change `model` to move an agent to another provider.
- Change `variant` to adjust reasoning effort.
- Change `mode` to make an agent primary, subagent-only, or both.
- Edit the orchestrator prompt to alter delegation and approval policy.
- Add another agent by adding another key to `agents`.

Keep provider prefixes explicit. `openai/...` consumes the ChatGPT/OpenAI
connection; `commandcode/...` consumes Command Code credits.

## Precedence

The plugin uses `??=` when adding agents and setting the default. A user-defined
agent with the same name wins. This makes local overrides possible without
forking the flow repository, while still allowing a fork for larger changes.
