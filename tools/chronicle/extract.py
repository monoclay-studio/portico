#!/usr/bin/env python3
"""Chronicle extractor: turns the orchestrating session's transcripts into permanent repo records.

Writes (idempotent; re-run at every checkpoint):
  docs/chronicle/data/owner-messages.json   every owner message (verbatim) with UTC timestamp
  docs/chronicle/data/owner-answers.json    owner answers to clarifying questions
  docs/chronicle/data/agents.json           every agent run: role/description, start, end, turns, tool uses, tokens
  docs/chronicle/agents/<start>-<slug>.md   each agent's brief (verbatim) and final report(s) (verbatim)
  docs/chronicle/data/session-stats.json    orchestrator stats (messages, tool use counts)
Usage: python3 -I tools/chronicle/extract.py <session-jsonl> <repo-root>
"""
import json, os, re, sys, collections, glob

sess, root = sys.argv[1], sys.argv[2]
sub_dir = sess[:-len('.jsonl')] + '/subagents'
out = os.path.join(root, 'docs/chronicle')
os.makedirs(os.path.join(out, 'data'), exist_ok=True)
os.makedirs(os.path.join(out, 'agents'), exist_ok=True)

def load(path):
    for line in open(path, errors='ignore'):
        try:
            yield json.loads(line)
        except Exception:
            continue

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') == 'text')
    return ''

NOISE = ('<system-reminder>', 'Another Claude session', '[SYSTEM NOTIFICATION', 'This session is being continued',
         '<task-notification>', 'This session\'s worker process')
owner, answers, ask_ids = [], [], {}
agent_desc = {}  # agentId -> description from the Agent tool call
pending_agent_calls = {}
stats = collections.Counter(); tools = collections.Counter(); first = last = None
seen_prompts = set()
reports_main = collections.defaultdict(list); followups = collections.defaultdict(list)
def capture_report(ts, txt):
    mm = re.search(r'<agent-message from="([a-z0-9]+)">', txt)
    if not mm: return
    body = re.sub(r'^.*?The report follows:\s*', '', txt, flags=re.S)
    body = re.split(r'\n</agent-message>|\nThat "other Claude session"', body)[0]
    body = '\n'.join(l[2:] if l.startswith('  ') else l for l in body.split('\n')).strip()
    if all(r['text'] != body for r in reports_main[mm.group(1)]):
        reports_main[mm.group(1)].append({'ts': ts, 'text': body})
for o in load(sess):
    ts = o.get('timestamp'); first = first or ts; last = ts or last
    t = o.get('type'); m = o.get('message') or {}
    att = o.get('attachment') if isinstance(o.get('attachment'), dict) else None
    if t == 'attachment' and att and att.get('type') == 'queued_command':
        p = att.get('prompt')
        if isinstance(p, list): p = text_of(p)
        if p and p.lstrip().startswith('<agent-message'):
            capture_report(ts, p)
        elif p and not p.startswith(NOISE) and p not in seen_prompts:
            seen_prompts.add(p); owner.append({'ts': ts, 'text': p, 'via': 'queued'})
    if t == 'assistant':
        stats['assistant_messages'] += 1
        for c in m.get('content', []) if isinstance(m.get('content'), list) else []:
            if c.get('type') == 'tool_use':
                tools[c.get('name')] += 1
                if c.get('name') == 'AskUserQuestion': ask_ids[c.get('id')] = c.get('input')
                if c.get('name') == 'Agent': pending_agent_calls[c.get('id')] = dict(c.get('input', {}), _ts=ts)
                if c.get('name') == 'SendMessage':
                    inp = c.get('input') or {}
                    followups[inp.get('to')].append({'ts': ts, 'text': inp.get('message', '')})
    if t == 'user' and not o.get('isSidechain'):
        c = m.get('content')
        if isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get('type') == 'tool_result':
                    rid = x.get('tool_use_id'); body = text_of(x.get('content')) if not isinstance(x.get('content'), str) else x.get('content')
                    if rid in ask_ids:
                        answers.append({'ts': ts, 'questions': ask_ids[rid], 'answer': body})
                    if rid in pending_agent_calls:
                        mm = re.search(r'agentId: ([a-f0-9]+)', body or '')
                        if mm: agent_desc[mm.group(1)] = pending_agent_calls[rid]
        txt = text_of(c) if not (isinstance(c, list) and any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in c)) else ''
        if txt and '<agent-message from=' in txt[:400]:
            capture_report(ts, txt)
        elif txt and not o.get('isMeta') and not txt.lstrip().startswith(NOISE) and txt not in seen_prompts:
            seen_prompts.add(txt); owner.append({'ts': ts, 'text': txt, 'via': 'message'})
owner.sort(key=lambda r: r['ts'] or '')
json.dump(owner, open(os.path.join(out, 'data/owner-messages.json'), 'w'), indent=1, ensure_ascii=False)
json.dump(answers, open(os.path.join(out, 'data/owner-answers.json'), 'w'), indent=1, ensure_ascii=False)
json.dump({'first': first, 'last': last, **stats, 'tool_uses': dict(tools.most_common())},
          open(os.path.join(out, 'data/session-stats.json'), 'w'), indent=1)

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', (s or 'agent').lower()).strip('-')[:60]

agents = []
files = {os.path.basename(f)[len('agent-'):-len('.jsonl')]: f for f in glob.glob(os.path.join(sub_dir, 'agent-*.jsonl'))}
for aid in sorted(set(files) | set(agent_desc) | set(reports_main)):
    f = files.get(aid)
    a_first = a_last = None; briefs = []; reports = []; tool_uses = 0; out_tok = 0; in_tok = 0; turns = 0
    if not f:
        d = agent_desc.get(aid, {})
        if d.get('prompt'): briefs.append({'ts': d.get('_ts'), 'text': d['prompt']})
        a_first = d.get('_ts') or (reports_main[aid][0]['ts'] if reports_main.get(aid) else None)
        a_last = reports_main[aid][-1]['ts'] if reports_main.get(aid) else a_first
        briefs += followups.get(aid, [])
        reports = list(reports_main.get(aid, []))
    for o in (load(f) if f else []):
        ts = o.get('timestamp'); a_first = a_first or ts; a_last = ts or a_last
        m = o.get('message') or {}
        if o.get('type') == 'user':
            c = m.get('content')
            if isinstance(c, str) or (isinstance(c, list) and not any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in c)):
                t = text_of(c)
                if t and not t.lstrip().startswith(('<system-reminder>', '[SYSTEM NOTIFICATION')):
                    briefs.append({'ts': ts, 'text': t})
        if o.get('type') == 'assistant':
            turns += 1
            u = m.get('usage') or {}
            out_tok += u.get('output_tokens', 0) or 0
            in_tok += (u.get('input_tokens', 0) or 0) + (u.get('cache_read_input_tokens', 0) or 0) + (u.get('cache_creation_input_tokens', 0) or 0)
            for c in m.get('content', []) if isinstance(m.get('content'), list) else []:
                if c.get('type') == 'tool_use':
                    tool_uses += 1
                    if c.get('name') == 'SubagentHandback':
                        inp = c.get('input') or {}
                        rep = inp.get('report') or inp.get('message') or inp.get('result') or json.dumps(inp)
                        reports.append({'ts': ts, 'text': rep})
    if f and not reports:
        reports = list(reports_main.get(aid, []))
    desc = agent_desc.get(aid, {})
    title = desc.get('description') or (briefs[0]['text'][:70] if briefs else aid)
    rec = {'transcript': 'full' if f else 'brief+reports only (agent log not preserved)', 'agent': aid, 'title': title, 'type': desc.get('subagent_type'), 'start': a_first, 'end': a_last,
           'turns': turns, 'tool_uses': tool_uses, 'output_tokens': out_tok, 'input_tokens_incl_cache': in_tok,
           'messages_received': len(briefs), 'reports': len(reports)}
    agents.append(rec)
    name = f"{(a_first or '')[:16].replace(':', '').replace('-', '')}-{slug(title)}.md"
    with open(os.path.join(out, 'agents', name), 'w') as w:
        w.write(f"# Agent run: {title}\n\n")
        w.write(f"- Started: {a_first} · last activity: {a_last}\n- Turns: {turns} · tool uses: {tool_uses} · "
                f"output tokens: {out_tok:,}\n- Type: {desc.get('subagent_type') or 'general-purpose'}\n\n")
        for i, b in enumerate(briefs):
            w.write(f"## {'Brief' if i == 0 else 'Follow-up message'} ({b['ts']})\n\n````text\n{b['text']}\n````\n\n")
        for r in reports:
            w.write(f"## Report ({r['ts']})\n\n````text\n{r['text']}\n````\n\n")
    rec['file'] = 'agents/' + name
agents.sort(key=lambda r: r['start'] or '')
json.dump(agents, open(os.path.join(out, 'data/agents.json'), 'w'), indent=1)
print(f"owner messages {len(owner)} · answers {len(answers)} · agent runs {len(agents)} · "
      f"reports {sum(a['reports'] for a in agents)} · session {first} → {last}")

# Owner directions, verbatim, in order (generated — do not edit by hand).
with open(os.path.join(out, '03-owner-directions.md'), 'w') as w:
    w.write('# Owner directions — verbatim, in order\n\n'
            '_Generated by `tools/chronicle/extract.py` from the orchestrating session. Times are UTC. Long pasted briefs '
            'are kept verbatim here and also as the canonical files `docs/product/brief.md`, '
            '`operational-readiness-brief.md` and `adoption-integration-brief.md`._\n\n')
    items = [('message', r['ts'], r['text']) for r in owner] + [('answers', a['ts'], a['answer']) for a in answers]
    for kind, ts, text in sorted(items, key=lambda x: x[1] or ''):
        label = 'Answers to clarifying questions' if kind == 'answers' else 'Owner'
        w.write(f'## {ts[:16].replace("T", " ")} UTC — {label}\n\n````text\n{text}\n````\n\n')
