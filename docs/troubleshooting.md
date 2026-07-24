# Troubleshooting

## Configuration

**"Your configuration could not be loaded…"**
You set `"flow": "custom"` without a valid configuration, so the plugin fell
back to the built-in flow and kept all its tools available. `/flow-config` shows
the reason. Run `/flow-setup`, fix the file, or `flow_configure reset=true` to
remove a corrupt one — then restart.

**A model id was rejected as not `provider/model`.**
Ids may contain extra slashes (`openrouter/anthropic/claude-sonnet-4`); those
are valid. Values with no slash, a leading slash, or whitespace are not.

**"Unknown OpenCode agent flow: …"**
The `flow` value matches no built-in flow. Valid values are the flows in
`src/flows/index.ts` plus `custom`. The error lists what is available.

**My model change did not take effect.**
Model bindings are applied when OpenCode starts. Restart it. `/flow-config`
shows what is saved and whether it is currently active.

**`/flow-config` says "saved but NOT active".**
The configuration exists but you have not selected it. Set
`{ "flow": "custom" }` in your plugin options and restart.

**My own `/flow-setup` command was replaced.**
It was not — the plugin only registers its commands when the name is unused.
A command you defined always wins.

## Discovery

**Discovery returns no models.**
OpenCode has no authenticated providers. Add one with `/connect` first, then
re-run discovery.

**A model shows `AA n/a`.**
The public Artificial Analysis page lists roughly the top 20 models, so niche
models have no published index. The model is still usable; it just ranks without
a quality signal.

**Quality says "bundled snapshot" instead of "live".**
The Artificial Analysis page was unreachable or its markup changed, so the
bundled fallback was used. Discovery still works. Try `refresh=true` later.

**Prices look wrong or missing.**
models.dev was unreachable and provider-supplied pricing was used, or the model
has no published price. The output notes which happened. Prices are USD per 1M
tokens, blended 3:1 input:output.

**The CLI lists providers I do not have.**
Without a running OpenCode server and with no providers in `opencode.json`,
`bun run setup` falls back to the entire models.dev catalog and warns you. Use
`/flow-setup` inside OpenCode, or pass `--server <url>`, for your real list.

**`bun run setup` exits immediately.**
It is interactive and requires a TTY. Run it directly in a terminal, not through
a pipe or CI step.

## Delegation

**Escalation to `deep` was rejected.**
By design. `deep` requires a concrete failed or blocked `routine` result in the
same run, plus one-use approval via `flow_approve_escalation`. Length or file
count is not evidence.

**A worker "completed" but produced nothing.**
It did not complete — missing, empty, or malformed reports are recorded as
failures or `invalid-output`, never as success.

**Concurrent writes were rejected.**
With [Rift](rift.md) enabled, concurrent writers must use `flow_rift_task`.
Ordinary shared-checkout concurrent writers are refused rather than silently
racing.

## Review

**Review was skipped.**
It should never be silently skipped. If the reviewer was unavailable or returned
malformed output, the orchestrator must disclose that and substitute one diff
self-review. See [Milestone review](review.md).

**A third review round was refused.**
Two rounds is the hard maximum.

## Rift

**"Rift root marker not found."**
Run `flow_rift_init` in that directory first. It is permission-gated because it
can alter workspace layout.

**"A Rift baseline from a previous run is still active."**
Integrate it, or run `flow_rift_cleanup`.

**Integration rejected my worker.**
Integration refuses undeclared changes, unchanged declarations, conflicts
between workers, files changed since the baseline, and escaping symlinks. The
error names which rule fired.

## Development

**`bun run docs:check` fails.**
Generated flow docs are stale. Run `bun run docs` and commit the result.

**The AGENTS.md test fails.**
`AGENTS.md` and `CLAUDE.md` drifted. They are mirrors — apply the change to both.

**The dashboard is blank.**
The dashboard's rendering lives in an inline script; a runtime error there
blanks the page. `bun test` executes that script against a document stub, so run
the suite — it will catch it.
