#!/usr/bin/env python3
"""Chronicle time helper (quality steward round 2, orchestrator v3 O3-1). Use it for EVERY timeline time.

Prints the authoritative UTC time of an event so that timeline entries are derived, never typed:
  when.py agent "<title substring>"   -> time of the agent's last assistant message (its report), read LIVE from the
                                         subagent transcript (not from the chronicle extract, which lags)
  when.py commit <sha>                -> committer time of the commit
  when.py now                         -> current UTC time
Output: "HH:MM  <source token>" — the token is what a verifier would check later.
"""
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

PROJ = os.path.expanduser('~/.claude/projects')


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
    else:
        t = datetime.now(timezone.utc)
        print(f'{t:%H:%M}  <!-- t: now @ {t:%Y-%m-%dT%H:%M:%SZ} -->')
