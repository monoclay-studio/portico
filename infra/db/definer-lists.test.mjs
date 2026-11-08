// The reviewed SECURITY DEFINER lists exist once (definer-registry.mjs); verify.sql check 7 carries a generated copy.
//   node --test infra/db/definer-lists.test.mjs      fails when they differ (review P3-9)
//   node infra/db/definer-lists.test.mjs --print     prints the SQL blocks to paste into verify.sql
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_DEFINER_FUNCTIONS, canonical, ROUTING_FUNCTIONS } from './definer-registry.mjs';

const verifySql = readFileSync(new URL('../restore-drill/verify.sql', import.meta.url), 'utf8');
const expected = {
  app_definers: [...APP_DEFINER_FUNCTIONS, ...ROUTING_FUNCTIONS.workerAndApp].map(canonical),
  worker_only_definers: ROUTING_FUNCTIONS.workerOnly.map(canonical),
};

function block(name) {
  const m = verifySql.match(new RegExp(`-- BEGIN GENERATED ${name}\\n([\\s\\S]*?)-- END GENERATED ${name}`));
  assert.ok(m, `verify.sql has no generated block ${name}`);
  return [...m[1].matchAll(/\('([^']+)'\)/g)].map((x) => x[1]);
}

if (process.argv.includes('--print')) {
  for (const [name, fns] of Object.entries(expected)) {
    process.stdout.write(`${name}:\n  ${fns.map((f) => `('${f}')`).join(', ')};\n`);
  }
} else {
  for (const name of Object.keys(expected)) {
    test(`verify.sql ${name} equals the registry`, () => {
      assert.deepEqual([...block(name)].sort(), [...expected[name]].sort());
    });
  }
  test('no function is both worker-only and app-callable', () => {
    const app = new Set(expected.app_definers);
    assert.deepEqual(
      expected.worker_only_definers.filter((f) => app.has(f)),
      [],
    );
  });
}
