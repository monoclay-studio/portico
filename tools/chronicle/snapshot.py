#!/usr/bin/env python3
"""Chronicle snapshot: one JSON file of measurable facts about the repository at this moment.
Usage: python3 -I tools/chronicle/snapshot.py [turbo-test-log]   (run from the repo root)
Writes docs/chronicle/data/snapshots/<UTC timestamp>.json. Re-run at every merge/checkpoint.
"""
import datetime, glob, json, os, re, subprocess, sys

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout.strip()

now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%MZ')
snap = {'taken_at': now, 'head': sh('git', 'rev-parse', '--short', 'HEAD')}
snap['git'] = {
    'commits_main': int(sh('git', 'rev-list', '--count', 'main') or 0),
    'commits_all_refs': int(sh('git', 'rev-list', '--all', '--count') or 0),
    'branches': sh('git', 'branch', '--format=%(refname:short)').split('\n'),
    'module_merges_to_main': [l for l in sh('git', 'log', 'main', '--merges', '--first-parent', '--format=%aI %s').split('\n') if l],
}
code = {}
for d in sorted(glob.glob('packages/*') + glob.glob('modules/*') + glob.glob('apps/*')):
    files = [f for f in glob.glob(d + '/**/*', recursive=True) if 'node_modules' not in f and 'dist/' not in f
             and os.path.isfile(f) and f.endswith(('.ts', '.tsx', '.sql'))]
    code[d] = {'files': len(files), 'lines': sum(sum(1 for _ in open(f, errors='ignore')) for f in files),
               'test_files': sum(1 for f in files if f.endswith(('.test.ts', '.test.tsx'))),
               'migrations': sum(1 for f in files if f.endswith('.sql'))}
snap['code'] = code
snap['code_totals'] = {k: sum(v[k] for v in code.values()) for k in ('files', 'lines', 'test_files', 'migrations')}
md = glob.glob('docs/**/*.md', recursive=True)
oq = open('docs/OPEN_QUESTIONS.md').read() if os.path.exists('docs/OPEN_QUESTIONS.md') else ''
snap['docs'] = {
    'markdown_files': len(md), 'markdown_lines': sum(sum(1 for _ in open(f, errors='ignore')) for f in md),
    'specs': len(glob.glob('docs/specs/*.md')), 'adrs': len(glob.glob('docs/adr/0*.md')),
    'parity_files': len(glob.glob('docs/parity/*.md')),
    'open_questions_total': len(re.findall(r'^### Q\d+', oq, re.M)),
    'open_questions_answered': len(re.findall(r'^### Q\d+.*Status: answered', oq, re.M)),
}
reviews = {}
for f in sorted(glob.glob('docs/orchestration/reviews/review-*.md')):
    t = open(f, errors='ignore').read()
    m = re.search(r'Counts?:?\**\s*:?\s*([^\n]+)', t)
    v = re.search(r'Verdict[^\n]*?\*\*([^*]+)\*\*', t)
    reviews[os.path.basename(f)] = {'counts': m.group(1).strip() if m else None, 'verdict': v.group(1).strip() if v else None}
snap['reviews'] = reviews
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    tests = {}
    for line in open(sys.argv[1], errors='ignore'):
        line = re.sub(r'\x1b\[[0-9;]*m', '', line)
        m = re.match(r'(@portico/[\w-]+):test:\s+Tests\s+(?:(\d+) failed \| )?(\d+) passed', line)
        if m: tests[m.group(1)] = {'passed': int(m.group(3)), 'failed': int(m.group(2) or 0)}
    snap['tests'] = tests
    snap['tests_total_passed'] = sum(v['passed'] for v in tests.values())
os.makedirs('docs/chronicle/data/snapshots', exist_ok=True)
path = f'docs/chronicle/data/snapshots/{now}.json'
json.dump(snap, open(path, 'w'), indent=1)
print(path, '· lines', snap['code_totals']['lines'], '· tests', snap.get('tests_total_passed'), '· commits', snap['git']['commits_main'])
