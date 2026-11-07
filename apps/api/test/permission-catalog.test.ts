import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFESTS } from '../src/composition';

/** Every permission any module checks must be registered in some manifest (role editors, templates, audits). */
describe('permission catalog completeness', () => {
  it('has no checked-but-unregistered permission keys in any composed module', () => {
    const registered = new Set(MANIFESTS.flatMap((m) => m.permissions.map((p) => p.key)));
    const modulesDir = join(import.meta.dirname, '..', '..', '..', 'modules');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const p = join(dir, e);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
      });
    const composed = new Set(MANIFESTS.map((m) => m.name));
    const missing: string[] = [];
    for (const mod of readdirSync(modulesDir).filter((m) => composed.has(m))) {
      for (const file of walk(join(modulesDir, mod, 'src'))) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(
          /requirePermission\(\s*\w+\s*,\s*'([a-zA-Z]+\.[a-zA-Z]+\.[a-zA-Z]+)'/g,
        )) {
          if (!registered.has(m[1] as string)) missing.push(`${mod}: ${m[1]}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
