#!/usr/bin/env python3
"""Chronicle time helper (orchestrator v3 O3-1; round-3 prototype adds `owner` and `trigger`, E-115).

Prints the authoritative UTC time of an event so that timeline entries are derived, never typed:
  when.py agent "<title substring>"   -> time of the agent's last assistant message (its report), read LIVE from the
                                         subagent transcript (not from the chronicle extract, which lags)
  when.py commit <sha>                -> committer time of the commit
  when.py owner "<text substring>"    -> time the owner's message was queued in the main session (the moment the
                                         owner sent it, not the moment the orchestrator read or recorded it)
  when.py trigger                     -> time the most recent scheduled task fired in the main session (a resume)
  when.py now                         -> current UTC time: ONLY for the orchestrator's own act at the moment of writing
Output: "HH:MM  <source token>" — the token is what a verifier checks later.
"""
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

PROJ = os.path.expanduser('~/.claude/projects')


def fmt(ts: str, token: str) -> str:
    t = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(timezone.utc)
    return f'{t:%H:%M}  <!-- t: {token} @ {ts} -->'


def main_sessions():
    # The orchestrating session's own transcript: <project>/<session>.jsonl (subagents live one level deeper).
    return sorted(glob.glob(f'{PROJ}/*/*.jsonl'), key=os.path.getmtime, reverse=True)


def agent(sub: str) -> str:
    best = None
    for meta in glob.glob(f'{PROJ}/*/*/subagents/*.meta.json'):
        try:
            desc = json.load(open(meta)).get('description') or ''
        except Exception:
            continue
        if sub.lower() not in desc.lower():
            continue
        last = None
        with open(meta.replace('.meta.json', '.jsonl')) as f:
            for line in f:
                d = json.loads(line)
                if d.get('type') == 'assistant' and d.get('timestamp'):
                    last = d['timestamp']
        if last and (best is None or last > best[0]):
            best = (last, os.path.basename(meta).split('.')[0], desc)
    if not best:
        sys.exit(f'no agent matching {sub!r}')
    t = datetime.fromisoformat(best[0].replace('Z', '+00:00'))
    return f'{t:%H:%M}  <!-- t: {best[1]} @ {best[0]} ({best[2]}) -->'


def owner(sub: str) -> str:
    """Earliest time a genuine owner message containing `sub` was queued or received."""
    for path in main_sessions():
        hits = []
        with open(path) as f:
            for line in f:
                d = json.loads(line)
                ts = d.get('timestamp')
                text = None
                if d.get('type') == 'queue-operation' and d.get('operation') == 'enqueue':
                    text = d.get('content') if isinstance(d.get('content'), str) else None
                elif d.get('type') == 'user':
                    c = (d.get('message') or {}).get('content')
                    if isinstance(c, str):
                        text = c
                if not text or not ts or text.lstrip().startswith('<') or text.startswith('[SYSTEM'):
                    continue  # task notifications, agent messages and system events are not the owner
                if sub.lower() in text.lower():
                    hits.append(ts)
        if hits:
            return fmt(min(hits), f'owner:{os.path.basename(path)[:8]}')
    sys.exit(f'no owner message containing {sub!r}')


def trigger() -> str:
    """Time the most recent scheduled task fired (its notification was queued) in the main session."""
    for path in main_sessions():
        last = None
        with open(path) as f:
            for line in f:
                d = json.loads(line)
                c = d.get('content') if d.get('type') == 'queue-operation' and d.get('operation') == 'enqueue' else None
                if isinstance(c, str) and 'scheduled trigger' in c:
                    last = d.get('timestamp')
        if last:
            return fmt(last, f'trigger:{os.path.basename(path)[:8]}')
    sys.exit('no scheduled-task notification found')


def commit(sha: str) -> str:
    iso = subprocess.check_output(['git', 'log', '-1', '--format=%cI', sha], text=True).strip()
    t = datetime.fromisoformat(iso).astimezone(timezone.utc)
    return f'{t:%H:%M}  <!-- t: commit:{sha} @ {t:%Y-%m-%dT%H:%M:%SZ} -->'


if __name__ == '__main__':
    kind = sys.argv[1]
    if kind == 'agent':
        print(agent(sys.argv[2]))
    elif kind == 'commit':
        print(commit(sys.argv[2]))
    elif kind == 'owner':
        print(owner(sys.argv[2]))
    elif kind == 'trigger':
        print(trigger())
    else:
        t = datetime.now(timezone.utc)
        print(f'{t:%H:%M}  <!-- t: now @ {t:%Y-%m-%dT%H:%M:%SZ} -->')
