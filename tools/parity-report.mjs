#!/usr/bin/env node
/**
 * Parity & edge-case coverage report (docs/parity/README.md).
 *   node tools/parity-report.mjs              → writes docs/parity/COVERAGE.md, prints summary
 *   node tools/parity-report.mjs --gate <m>   → exit 1 if module <m> has P0 rows not tested or P1 rows missing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'docs', 'parity');
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.md') && !['README.md', 'COVERAGE.md'].includes(f))
  : [];
const STATUSES = ['missing', 'specified', 'building', 'built', 'tested', 'deferred', 'different', 'n/a'];

function parse(file) {
  const rows = { par: [], ec: [] };
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 6) continue;
    const id = cells[0];
    if (/^PAR-/.test(id))
      rows.par.push({ id, name: cells[1], priority: cells[3], status: cells[4].toLowerCase() });
    else if (/^EC-/.test(id))
      rows.ec.push({ id, name: cells[1], priority: cells[3], status: cells[4].toLowerCase() });
  }
  return rows;
}

const report = [];
const problems = [];
for (const f of files.sort()) {
  const module = f.replace(/\.md$/, '');
  const { par, ec } = parse(f);
  for (const r of [...par, ...ec])
    if (!STATUSES.includes(r.status)) problems.push(`${f}: ${r.id} has unknown status "${r.status}"`);
  const count = (rows, pred) => rows.filter(pred).length;
  const tested = (rows) =>
    count(rows, (r) => r.status === 'tested' || r.status === 'n/a' || r.status === 'different');
  const p0open = [...par, ...ec].filter(
    (r) => r.priority === 'P0' && !['tested', 'n/a', 'different'].includes(r.status),
  );
  const p1missing = [...par, ...ec].filter((r) => r.priority === 'P1' && r.status === 'missing');
  report.push({
    module,
    par: par.length,
    ec: ec.length,
    parDone: tested(par),
    ecDone: tested(ec),
    p0open,
    p1missing,
  });
}

const pct = (a, b) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`);
const lines = [
  '# Parity coverage (generated — `pnpm parity`)',
  '',
  '| Module | Capabilities | Tested/equivalent | Edge cases | Tested | P0 still open | P1 missing |',
  '|---|---|---|---|---|---|---|',
  ...report.map(
    (r) =>
      `| ${r.module} | ${r.par} | ${pct(r.parDone, r.par)} | ${r.ec} | ${pct(r.ecDone, r.ec)} | ${r.p0open.length} | ${r.p1missing.length} |`,
  ),
  '',
];
writeFileSync(join(dir, 'COVERAGE.md'), lines.join('\n'));
console.log(lines.join('\n'));
if (problems.length) console.error(problems.join('\n'));

const gateIdx = process.argv.indexOf('--gate');
if (gateIdx > 0) {
  const m = process.argv[gateIdx + 1];
  const r = report.find((x) => x.module === m);
  if (!r) {
    console.error(`No parity file for module "${m}" — a module cannot pass the gate without one.`);
    process.exit(1);
  }
  if (r.p0open.length || r.p1missing.length) {
    console.error(
      `Gate failed for ${m}:\n  P0 not tested: ${r.p0open.map((x) => x.id).join(', ') || 'none'}\n  P1 missing: ${r.p1missing.map((x) => x.id).join(', ') || 'none'}`,
    );
    process.exit(1);
  }
  console.log(`Gate passed for ${m}.`);
}
