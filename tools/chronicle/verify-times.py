#!/usr/bin/env python3
"""Refuse timeline entries whose time is typed rather than derived (orchestrator v3, O3-1; round-3 `now` rule, E-115).

Every NEW line in docs/chronicle/01-timeline.md (staged diff) that starts an entry with a time — `- **HH:MM` — must
carry a source token printed by tools/chronicle/when.py: `<!-- t: <source> @ <ISO-8601 UTC> ... -->`, and HH:MM must
equal the token's time rounded DOWN to the minute. Exit 1 with the offending lines otherwise.
Usage (from the repo root, after staging): python3 -I tools/chronicle/verify-times.py
"""
import re
import subprocess
import sys
from datetime import datetime, timezone

PATH = 'docs/chronicle/01-timeline.md'
diff = subprocess.run(['git', 'diff', '--cached', '-U0', '--', PATH], capture_output=True, text=True).stdout
entry = re.compile(r'^\+\s*-\s+\*\*(\d{2}):(\d{2})\b')
token = re.compile(r'<!--\s*t:\s*[^@]*@\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)')
bad = []
for line in diff.splitlines():
    if line.startswith('+++'):
        continue
    m = entry.match(line)
    if not m:
        continue
    t = token.search(line)
    if not t:
        bad.append(f'no source token: {line[1:120]}')
        continue
    src = re.search(r'<!--\s*t:\s*([^@\s]*)', line).group(1)
    title = line[m.end():].lstrip(' —-').lower()
    if src == 'now' and title.startswith(('owner', 'resumed', 'resume')):
        bad.append(f'`now` dates the record, not the event (use when.py owner/trigger): {line[1:120]}')
        continue
    iso = t.group(1)
    if not iso.endswith('Z'):
        iso += 'Z'
    when = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(timezone.utc)
    if (int(m.group(1)), int(m.group(2))) != (when.hour, when.minute):
        bad.append(f'time {m.group(1)}:{m.group(2)} != source {when:%H:%M}: {line[1:120]}')
if bad:
    print('Timeline times must come from tools/chronicle/when.py (orchestrator v3 O3-1):', file=sys.stderr)
    for b in bad:
        print('  ' + b, file=sys.stderr)
    sys.exit(1)
