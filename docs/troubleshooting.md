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

**The running agents are not the ones I configured.**
This plugin is probably loaded twice — commonly installed globally from npm and
again per project. Whichever instance loads first supplies every agent, so an
older copy can silently win while the newer one still registers its commands.
`/flow-config` names the affected agents, and a warning is logged at startup.
Remove one copy from your `opencode.json`.

**A model shows `price n/a`.**
Nobody publishes a price for it. A provider reporting `0` is only treated as
free when models.dev agrees; otherwise the provider simply is not metering
(subscription, OAuth, or a gateway models.dev does not cover) and the price is
recorded as unknown rather than as free. This keeps unmetered frontier models
from sweeping the cost-led ranking on a fake $0.

**My own `/flow-setup` command was replaced.**
It was not — the plugin only registers its commands when the name is unused.
A command you defined always wins.

## Discovery

**Discovery returns no models.**
OpenCode has no authenticated providers. Add one with `/connect` first, then
re-run discovery.

**A model shows `quality n/a`.**
Roughly 160 models carry a published Artificial Analysis index; the rest have
none. The model is still usable, it just ranks on cost alone.

**Quality says "bundled snapshot" instead of "live".**
OpenRouter's models endpoint was unreachable, so the bundled 116-model snapshot
was used. Discovery still works. Try `refresh=true` later.

**A note says quality coverage dropped sharply.**
The field carrying these indices is public but undocumented, so a large drop is
reported as an early warning that it may have changed shape. Ranking continues
with whatever resolved.

**Prices look wrong or missing.**
models.dev was unreachable and provider-supplied pricing was used, or the model
has no published price. The output notes which happened. Prices are USD per 1M
tokens, blended 3:1 input:output.

**The CLI lists providers I do not have.**
Without a running OpenCode server and with no providers in `opencode.json`,
`bun run setup` falls back to the entire models.dev catalog and warns you. Use
`/flow-setup` inside OpenCode, or pass `--server <url>`, for your real list.

**`bun run setup` exits immediately.**
The interactive mode requires a TTY. Run it in a real terminal, or use the
non-interactive form: `bun run setup --orchestrator <model> --routine <model>
--billing <provider>=<source> --yes`. See `bun run setup --help`.

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

**`flow_rift_status` says the CLI is not runnable.**
`rift` is not installed or not on PATH. Install `rift-snapshot`, or set
`rift.enabled` to false.

**Initialization fails with "does not support Linux copy-on-write reflinks".**
Your filesystem cannot host Rift. It needs btrfs, a Linux filesystem with native
reflink support, or APFS. Plain ext4 will not work, and this is not something
configuration can fix.

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
