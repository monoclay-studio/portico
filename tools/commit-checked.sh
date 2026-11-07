#!/usr/bin/env bash
# Orchestrator commits to main: commit only when lint (Biome + module boundaries) passes.
# Usage: tools/commit-checked.sh "<commit message>" <paths...>
set -uo pipefail
msg=$1; shift
pnpm format >/dev/null 2>&1
if ! pnpm lint >/tmp/commit-checked-lint.log 2>&1; then
  echo "NOT COMMITTED: lint failed (see /tmp/commit-checked-lint.log)" >&2; exit 1
fi
git add -- "$@" || exit 1
if git diff --cached --name-only | grep -qx 'docs/chronicle/01-timeline.md'; then
  python3 -I tools/chronicle/verify-times.py || { echo "NOT COMMITTED: timeline times not derived (tools/chronicle/when.py)" >&2; exit 1; }
fi
git commit -q -m "$msg" && git log --oneline -1
