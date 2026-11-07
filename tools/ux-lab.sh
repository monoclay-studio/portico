#!/usr/bin/env bash
# UX lab for the continuous UX loop (docs/ux/README.md): a fresh, seeded copy of the latest product.
#   tools/ux-lab.sh refresh   rebuild branch ux/lab from main (+ any unmerged UI branch in UX_LAB_EXTRA_BRANCHES),
#                             recreate the portico_ux database, migrate and seed demo data
#   tools/ux-lab.sh start     start API on :4300 and the staff app on :5380 (foreground; run in background)
set -euo pipefail
REPO=${REPO:-/home/user/portico}
LAB=${LAB:-/home/user/wt/uxlab}
DB=${UX_LAB_DB:-portico_ux}
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/$DB
export APP_DATABASE_URL=postgres://portico_app:portico_app_dev@127.0.0.1:5432/$DB
case "${1:-}" in
  refresh)
    bash "$REPO/tools/db-up.sh"
    if [ ! -d "$LAB" ]; then git -C "$REPO" worktree add -q "$LAB" -B ux/lab main; fi
    git -C "$LAB" checkout -q -B ux/lab main
    for b in ${UX_LAB_EXTRA_BRANCHES:-}; do git -C "$LAB" merge -q --no-edit "$b"; done
    (cd "$LAB" && pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null)
    psql -h 127.0.0.1 -U postgres -qc "drop database if exists $DB with (force)" >/dev/null
    (cd "$LAB" && pnpm migrate >/dev/null)
    if (cd "$LAB" && pnpm --filter @portico/backoffice run 2>/dev/null | grep -q "seed:dev"); then
      (cd "$LAB" && pnpm --filter @portico/backoffice seed:dev >/dev/null)
    else
      (cd "$LAB" && pnpm seed:demo >/dev/null)
    fi
    echo "UX lab refreshed at $(git -C "$LAB" rev-parse --short HEAD)"
    ;;
  start)
    cd "$LAB"
    PORT=4300 LOG_LEVEL=warn pnpm --filter @portico/api exec tsx src/main.ts &
    (cd apps/backoffice && PORTICO_API_URL=http://127.0.0.1:4300 npx vite --port 5380 --strictPort --host 127.0.0.1) &
    wait
    ;;
  *) echo "usage: $0 refresh|start" >&2; exit 2 ;;
esac
