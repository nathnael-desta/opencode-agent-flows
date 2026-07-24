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

## Validation status

The lifecycle is covered by tests using a fake CLI plus real filesystem
manifests and guarded integration behavior.

**Real Rift execution has not been validated on the development host**, which
runs ext4 without `rift` installed. Proving it on btrfs, XFS with reflinks, or
APFS remains an operational step — see the Rift section of
[Manual testing](MANUAL-TESTING.md), and run it in a disposable repository
first.
