#!/usr/bin/env bash
# Usage-guardrail checkpoint (docs/orchestration/usage-guardrail.md): commit work in progress in EVERY worktree and
# push EVERY branch, so a resumed or brand-new session loses nothing. Run AFTER stopping running agents.
set -uo pipefail
REPO=${REPO:-/home/user/portico}
TRAILER=$'\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR'
cd "$REPO" || exit 1
# Chronicle first (docs/chronicle/README.md): agent transcripts live in the container and are lost when it is reclaimed.
SESSION_LOG=${SESSION_LOG:-$(ls -t "$HOME"/.claude/projects/*portico*/*.jsonl 2>/dev/null | head -1)}
if [ -n "$SESSION_LOG" ] && [ -f "$SESSION_LOG" ]; then
  python3 -I tools/chronicle/extract.py "$SESSION_LOG" "$REPO" && python3 -I tools/chronicle/snapshot.py \
    && echo "chronicle refreshed from $SESSION_LOG"
fi
git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  br=$(git -C "$wt" branch --show-current 2>/dev/null)
  [ -z "$br" ] && continue
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    git -C "$wt" add -A && git -C "$wt" -c commit.gpgsign=false commit -q -m "wip($br): usage-limit checkpoint$TRAILER" \
      && echo "committed WIP: $br"
  fi
done
for br in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  if git push -q origin "$br" >/dev/null 2>&1 || { sleep 4; git push -q origin "$br" >/dev/null 2>&1; }; then
    echo "pushed: $br"
  else
    echo "PUSH FAILED: $br"
  fi
done
