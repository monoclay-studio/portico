// Supply-chain invariants (review P2-7 and main's ci.yml): every base image is pinned by digest, every GitHub
// Action by a full commit SHA, and dependabot proposes updates for each pinned thing.
//   node --test infra/ci/test/supply-chain.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const dockerfiles = ['apps/api/Dockerfile', 'apps/worker/Dockerfile', 'infra/restore-drill/Dockerfile'];
const workflows = ['.github/workflows/ci.yml', 'infra/ci/deploy.yml.example'];

test('every base image is pinned by digest', () => {
  for (const f of dockerfiles) {
    const text = read(f);
    for (const m of text.matchAll(/^ARG (\w*IMAGE)=(\S+)$/gm)) {
      assert.match(m[2], /@sha256:[0-9a-f]{64}$/, `${f}: ${m[1]} is not digest-pinned`);
    }
    for (const m of text.matchAll(/^FROM (\S+)/gm)) {
      const ref = m[1];
      if (ref.startsWith('${') || /^\w+$/.test(ref)) continue; // ARG or an earlier stage
      assert.match(ref, /@sha256:[0-9a-f]{64}$/, `${f}: FROM ${ref} is not digest-pinned`);
    }
  }
  const pg = read('infra/terraform/modules/single-host/variables.tf').match(/default\s*=\s*"(public\.ecr\.aws\/docker\/library\/postgres[^"]+)"/);
  assert.ok(pg && /@sha256:[0-9a-f]{64}$/.test(pg[1]), 'demo Postgres image is not digest-pinned');
});

test('pnpm is installed with a verified hash, never a bare npm install', () => {
  for (const f of ['apps/api/Dockerfile', 'apps/worker/Dockerfile']) {
    const text = read(f);
    assert.match(text, /corepack install --global pnpm@[\d.]+\+sha512\.[0-9a-f]{128}/, f);
    assert.doesNotMatch(text, /npm install --global/, f);
  }
});

test('every action is pinned to a 40-hex commit SHA', () => {
  for (const f of workflows) {
    for (const m of read(f).matchAll(/uses:\s*([^\s#]+)/g)) {
      if (m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]}`);
    }
  }
});

test('dependabot covers images, the tsx lockfile, terraform and actions', () => {
  const d = read('.github/dependabot.yml');
  for (const needle of ['package-ecosystem: docker', '/apps/api', '/apps/worker', '/infra/restore-drill', '/infra/docker/tsx-runtime', 'package-ecosystem: terraform', 'package-ecosystem: github-actions']) {
    assert.ok(d.includes(needle), `dependabot.yml lacks ${needle}`);
  }
});
