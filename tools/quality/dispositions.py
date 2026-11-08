#!/usr/bin/env python3
"""Disposition check (orchestrator v4 O4-2; canary C-L4-12).

Lists every finding ID in a checker's findings file that no disposition file mentions. A disposition is a
pending-fixes line, a refinement or decision entry, an acceptance check, or an explicit "rejected: <reason>" line
that names the ID.
Usage: python3 -I tools/quality/dispositions.py <findings.md> <disposition file> [<disposition file> ...]
Exit 1 when any finding has no disposition.
"""
import re
import sys

findings, *dispo = sys.argv[1:]
text = open(findings).read()
# Finding IDs are defined where they are bolded with a severity: **R2a-P1-F01 (major) [SIM].
ids = []
for m in re.finditer(r'\*\*([A-Z][A-Za-z0-9]*(?:-[A-Z0-9]+)*-F\d+) \(([^)]*)\)', text):
    if m.group(1) not in [i for i, _ in ids]:
        ids.append((m.group(1), m.group(2).split(';')[0].strip()))
pool = '\n'.join(open(p).read() for p in dispo)
missing = [(i, sev) for i, sev in ids if not re.search(re.escape(i) + r'\b', pool)]
print(f'{len(ids) - len(missing)} of {len(ids)} findings have a disposition')
for i, sev in missing:
    print(f'  no disposition: {i} ({sev})')
sys.exit(1 if missing else 0)
