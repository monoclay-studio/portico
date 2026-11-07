#!/usr/bin/env node
/**
 * Architecture guardrail (ADR-0001/0003): modules never import other modules and never touch another
 * module's database schema. Cross-module collaboration goes through ports bound in apps/api/src/composition.ts.
 *
 * Checks:
 *  1. modules/<m>/src/** must not import '@portico/<other-module>' (tests may, for wiring real providers).
 *  2. modules/<m>/migrations/*.sql must not create/alter/reference objects in another module's schema
 *     (except `core.` helpers and `platform.` SECURITY DEFINER lookup functions explicitly allowed below).
 *  3. modules/<m>/src/** must not reference another module's tables in SQL strings ('<schema>.<table>').
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const modulesDir = join(root, 'modules');
const modules = existsSync(modulesDir) ? readdirSync(modulesDir).filter((d) => statSync(join(modulesDir, d)).isDirectory()) : [];
const schemaOf = (m) => m.replace(/-/g, '_');
const ALLOWED_CROSS_SCHEMA = [/\bplatform\.tenant_environment\(/, /\bplatform\.tenant_summaries\(/];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const problems = [];
for (const m of modules) {
  const others = modules.filter((o) => o !== m);
  const src = walk(join(modulesDir, m, 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  for (const file of src) {
    const text = readFileSync(file, 'utf8');
    for (const o of others) {
      if (new RegExp(`from ['"]@portico/${o}(/[^'"]*)?['"]`).test(text)) {
        problems.push(`${relative(root, file)}: imports @portico/${o} — use a port in src/ports.ts instead`);
      }
      const sch = schemaOf(o);
      // Kysely table access: selectFrom('inventory.units'), innerJoin('finance.folios as f'), …
      const kysely = new RegExp(`\\.(selectFrom|insertInto|updateTable|deleteFrom|innerJoin|leftJoin|rightJoin|fullJoin|mergeInto)\\(\\s*['"\`]${sch}\\.`, 'g');
      for (const match of text.matchAll(kysely)) {
        problems.push(`${relative(root, file)}: ${match[1]}('${sch}.…') — another module's table; use a port`);
      }
      // Raw SQL in sql`…` templates
      for (const block of text.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)) {
        for (const ref of (block[1] ?? '').matchAll(new RegExp(`\\b${sch}\\.[a-z_]+\\(?`, 'g'))) {
          const snippet = ref[0];
          if (ALLOWED_CROSS_SCHEMA.some((r) => r.test(snippet))) continue;
          problems.push(`${relative(root, file)}: raw SQL references ${snippet} — another module's schema`);
        }
      }
    }
  }
  const migrations = walk(join(modulesDir, m, 'migrations')).filter((f) => f.endsWith('.sql'));
  for (const file of migrations) {
    const text = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
    for (const o of others) {
      const ref = new RegExp(`\\b${schemaOf(o)}\\.[a-z_]+`, 'g');
      for (const match of text.matchAll(ref)) {
        const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index));
        if (ALLOWED_CROSS_SCHEMA.some((r) => r.test(line))) continue;
        problems.push(`${relative(root, file)}: references ${match[0]} — no cross-module foreign keys or objects`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Module boundary violations (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Module boundaries OK (${modules.length} modules checked).`);
