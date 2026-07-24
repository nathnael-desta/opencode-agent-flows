# Rift isolation

Rift gives concurrent writers **copy-on-write snapshots** of your exact working
tree, so parallel workers cannot corrupt each other's edits. It is opt-in and
experimental.

> [!WARNING]
> Rift is disabled by default and must never be enabled casually. It requires
> btrfs, a Linux filesystem with native reflinks, or APFS. Windows is not
> supported.

## Enabling it

Install `rift-snapshot`, then:

```json
{ "rift": { "enabled": true, "command": "rift", "runHooks": false, "retainWorkspaces": false } }
```

The plugin **never** initializes Rift automatically, because `rift init` can
convert a btrfs directory into a subvolume. `flow_rift_init` always opens an
explicit permission prompt.

## Lifecycle

```text
flow_rift_begin      → one immutable baseline of the exact dirty workspace
flow_rift_task  ×N   → independent workers, run concurrently
flow_rift_integrate  → guarded central integration
flow_rift_cleanup    → discard anything unintegrated
```

Only the **root orchestrator** may drive these tools.

### Baselines

The baseline captures staged, unstaged, untracked, and dirty state — an exact
snapshot, not a clean checkout. Baseline creation always disables hooks so the
snapshot stays faithful. Worker hooks remain configurable via `runHooks`.

A stale baseline from a previous run must be integrated or cleaned before a new
one can start. Worker snapshots use run-qualified names so concurrent runs
cannot collide.

## Integration safeguards

Integration is where parallel work usually goes wrong, so it is strict. It
**rejects**:

- Undeclared changes — workers must declare every path they changed.
- Declared paths that did not actually change.
- Conflicting outputs between workers.
- Any live source file that changed since the baseline (refuses to overwrite).
- Absolute or workspace-escaping symlinks.

It **handles**: additions, deletions, file-to-directory and directory-to-file
replacements, and preserves file permissions.

Malformed worker workspaces are tracked so cleanup cannot leak them.

> [!IMPORTANT]
> There is **no silent fallback** to concurrent shared-checkout writers. With
> Rift enabled, ordinary `task` calls for concurrent writers are rejected — you
> get an error, not a quiet race condition.

## Checking your setup

`flow_rift_status` distinguishes the three states that matter:

| State | What it means |
|---|---|
| CLI not runnable | `rift` is not installed or not on PATH |
| Installed, not initialized | The CLI works but this directory is not a Rift workspace — the message quotes the CLI's own reason |
| Ready | Initialized and usable |

> [!TIP]
> If initialization fails with *"does not support Linux copy-on-write
> reflinks"*, your filesystem cannot host Rift. That is a hard requirement, not
> a configuration issue.

## Validation status

The lifecycle is covered by tests using a fake CLI plus real filesystem
manifests and guarded integration behavior. Additional integration tests run
against the **real** `rift` binary when one is on PATH and skip otherwise; they
pin the CLI contract (no `--version` flag, `--help` exits 0, `list` exits 1 when
uninitialized, `init` fails loudly on an unsupported filesystem).

**Copy-on-write itself has still not been proven on a supported filesystem.**
The development host runs ext4 without reflink support, where `rift init`
correctly refuses to initialize. Proving real isolation on btrfs, XFS with
reflinks, or APFS remains an operational step — see the Rift section of
[Manual testing](MANUAL-TESTING.md), and run it in a disposable repository
first.
