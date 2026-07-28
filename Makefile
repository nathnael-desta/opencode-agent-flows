SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:
.RECIPEPREFIX := >

VERSION ?= patch
BRANCH ?= main

.PHONY: help check package publish release

help:
>printf '%s\n' \
  'make check                 Run documentation, tests, type checks, and package validation.' \
  'make package               Preview the files that npm would publish.' \
  'make publish               Validate, then publish the current version using npm authentication.' \
  'make release VERSION=patch Release committed work to npm and GitHub.'

check:
>bun run verify
>npm pack --dry-run

package:
>npm pack --dry-run

publish: check
>npm publish --access public

release:
>test "$$(git branch --show-current)" = "$(BRANCH)" || { printf 'Release must run from %s.\n' "$(BRANCH)" >&2; exit 1; }
>test -z "$$(git status --porcelain)" || { printf 'Commit or stash all changes before releasing.\n' >&2; exit 1; }
>git fetch origin "$(BRANCH)"
>git merge-base --is-ancestor "origin/$(BRANCH)" HEAD || { printf 'Local %s is behind origin/%s. Update first.\n' "$(BRANCH)" "$(BRANCH)" >&2; exit 1; }
>$(MAKE) check
>npm whoami
>npm version "$(VERSION)" --no-git-tag-version
>bun install
>bun run verify
>npm pack --dry-run
>version="$$(node -p "require('./package.json').version")"
>git add package.json bun.lock
>git commit -m "Release v$$version"
>git tag "v$$version"
>git push origin HEAD:"$(BRANCH)"
>git push origin "v$$version"
>$(MAKE) publish
