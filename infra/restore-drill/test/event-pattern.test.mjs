// "A drill that didn't run always pages someone" — the EventBridge rule part. Evaluates the DEPLOYED pattern text
// (modules/restore-drill/task-stopped-pattern.json.tftpl) against sample ECS Task State Change events with a small
// matcher for the operators it uses (exact, prefix, anything-but, exists, $or), per the EventBridge docs.
//   node --test infra/restore-drill/test/event-pattern.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const FAMILY = 'arn:aws:ecs:ap-south-1:123456789012:task-definition/portico-prod-aps1-c01-restore-drill';
const PLACEHOLDER = ['$', '{family_arn_prefix}'].join(''); // the Terraform template variable
const pattern = JSON.parse(
  readFileSync(
    new URL('../../terraform/modules/restore-drill/task-stopped-pattern.json.tftpl', import.meta.url),
    'utf8',
  ).replace(PLACEHOLDER, FAMILY),
);

const values = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
function matchField(rules, value) {
  const vs = values(value);
  return rules.some((r) => {
    if (r === null || typeof r !== 'object') return vs.some((v) => v === r);
    if ('exists' in r) return r.exists ? vs.length > 0 : vs.length === 0;
    if ('prefix' in r) return vs.some((v) => typeof v === 'string' && v.startsWith(r.prefix));
    if ('anything-but' in r) return vs.length > 0 && vs.every((v) => !values(r['anything-but']).includes(v));
    throw new Error(`operator not modelled: ${JSON.stringify(r)}`);
  });
}
function matches(p, event) {
  return Object.entries(p).every(([k, rule]) => {
    if (k === '$or') return rule.some((alt) => matches(alt, event));
    const v = event?.[k];
    if (Array.isArray(rule)) return matchField(rule, Array.isArray(v) ? v : v);
    // nested object: arrays of objects match when any element matches (EventBridge flattens arrays)
    if (Array.isArray(v)) return v.some((el) => matches(rule, el)) || (v.length === 0 && matches(rule, {}));
    return matches(rule, v ?? {});
  });
}
const ev = (detail) => ({ source: 'aws.ecs', 'detail-type': 'ECS Task State Change', detail });
const stopped = (extra) => ev({ lastStatus: 'STOPPED', taskDefinitionArn: `${FAMILY}:7`, ...extra });

test('image pull failure (TaskFailedToStart, no exit code) pages', () => {
  assert.ok(
    matches(pattern, stopped({ stopCode: 'TaskFailedToStart', containers: [{ name: 'restore-drill' }] })),
  );
});
test('a container without any exit code pages even without a stop code', () => {
  assert.ok(
    matches(
      pattern,
      stopped({ stopCode: 'EssentialContainerExited', containers: [{ name: 'restore-drill' }] }),
    ),
  );
});
test('non-zero exit pages', () => {
  assert.ok(
    matches(pattern, stopped({ stopCode: 'EssentialContainerExited', containers: [{ exitCode: 1 }] })),
  );
});
test('the daily freshness family is covered too', () => {
  assert.ok(
    matches(pattern, {
      ...stopped({ containers: [{ exitCode: 2 }] }),
      detail: {
        lastStatus: 'STOPPED',
        taskDefinitionArn: `${FAMILY}-freshness:3`,
        containers: [{ exitCode: 2 }],
      },
    }),
  );
});
test('a clean exit 0 does not page', () => {
  assert.ok(
    !matches(pattern, stopped({ stopCode: 'EssentialContainerExited', containers: [{ exitCode: 0 }] })),
  );
});
test('other families and running tasks do not page', () => {
  assert.ok(
    !matches(
      pattern,
      ev({
        lastStatus: 'STOPPED',
        taskDefinitionArn: 'arn:aws:ecs:ap-south-1:123456789012:task-definition/portico-prod-aps1-c01-api:9',
        containers: [{ exitCode: 1 }],
      }),
    ),
  );
  assert.ok(
    !matches(
      pattern,
      ev({ lastStatus: 'RUNNING', taskDefinitionArn: `${FAMILY}:7`, containers: [{ name: 'x' }] }),
    ),
  );
});
