/**
 * SLA timers and escalation with a fixed clock, service-request completion semantics (brief §8: a message
 * saying "done" is insufficient — the task must be done), DND welfare checks and the scheduled job.
 */
import { runDueJobs } from '@portico/db';
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operationsJobs } from '../src';
import {
  ATTENDANT_GRANTS,
  eventsOf,
  type Harness,
  publish,
  SUPERVISOR_GRANTS,
  seedUnits,
  setupOrg,
  startHarness,
} from './support';

let h: Harness;
beforeAll(async () => {
  h = await startHarness('2026-11-07T04:00:00.000Z'); // 09:00 Maldives
});
afterAll(async () => h?.close());

const MIN = 60_000;

describe('service requests and SLA escalation (fixed clock)', () => {
  it('acknowledgement, overdue and department-head escalations fire once each, at the configured times', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setPolicy(tx, {
        key: 'operations.settings',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: {
          escalation: {
            guest_services: [
              { from: 'created', afterMinutes: 10, target: 'supervisor' },
              { from: 'due', afterMinutes: 0, target: 'supervisor' },
              { from: 'due', afterMinutes: 30, target: 'department_head' },
            ],
          },
        },
        reason: 'Guest services SLA',
      }),
    );
    const [villa] = await seedUnits(h, org, [{ number: 'B12' }]);
    if (!villa) throw new Error('unit');
    const desk = org.as([{ permission: 'operations.task.manage' }, { permission: 'operations.unit.read' }], {
      displayName: 'Front desk',
    });
    const runner = org.as([{ permission: 'operations.task.manage' }]);
    const run = () => org.tx(runner, (tx) => h.ops.runEscalations(tx, org.propertyId));

    h.clock.set('2026-11-07T04:00:00.000Z');
    const sr = await org.tx(desk, (tx) =>
      h.ops.createServiceRequest(tx, {
        propertyId: org.propertyId,
        unitId: villa,
        channel: 'phone',
        category: 'Extra towels',
        description: 'Two extra bath towels and a beach bag',
      }),
    );
    // normal priority → due in 60 min (10:00 local); escalation path snapshot on the task.
    expect(sr).toMatchObject({
      status: { serviceRequest: 'open', task: 'open' },
      task: {
        dueAt: '2026-11-07T05:00:00.000Z',
        departmentKind: 'guest_services',
        nextEscalationAt: '2026-11-07T04:10:00.000Z',
      },
      owner: { kind: 'department' },
    });

    h.clock.set('2026-11-07T04:09:59.000Z');
    expect((await run()).escalated).toEqual([]);
    h.clock.set('2026-11-07T04:10:00.000Z');
    expect((await run()).escalated).toEqual([
      expect.objectContaining({ taskId: sr.task.id, level: 1, target: 'supervisor' }),
    ]);
    expect((await run()).escalated).toEqual([]); // fires once

    h.clock.set('2026-11-07T04:59:00.000Z');
    expect((await run()).escalated).toEqual([]);
    h.clock.set('2026-11-07T05:00:00.000Z');
    expect((await run()).escalated).toEqual([
      expect.objectContaining({ level: 2, target: 'supervisor', minutesOverdue: 0 }),
    ]);
    h.clock.set('2026-11-07T05:29:00.000Z');
    expect((await run()).escalated).toEqual([]);
    h.clock.set('2026-11-07T05:30:00.000Z');
    expect((await run()).escalated).toEqual([
      expect.objectContaining({ level: 3, target: 'department_head', minutesOverdue: 30 }),
    ]);
    h.clock.set('2026-11-07T08:00:00.000Z');
    expect((await run()).escalated).toEqual([]); // path exhausted

    const events = await eventsOf(h, org.tenantId, 'operations.task.escalated');
    expect(events.map((e) => [e.payload.level, e.payload.target, e.payload.reason])).toEqual([
      [1, 'supervisor', 'not_acknowledged'],
      [2, 'supervisor', 'overdue'],
      [3, 'department_head', 'overdue'],
    ]);
    const task = await org.tx(desk, (tx) => h.ops.getTask(tx, sr.task.id));
    // Escalation is time-derived: it never bumps the version (no false conflicts for offline devices).
    expect(task.version).toBe(sr.task.version);
    expect(task.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'overdue', severity: 'blocking' })]),
    );
    expect(task.history.filter((x) => x.kind === 'escalated')).toHaveLength(3);
  });

  it('starting a task in time skips the acknowledgement step; completing it stops the clock', async () => {
    const org = await setupOrg(h);
    const desk = org.as([{ permission: 'operations.task.manage' }]);
    h.clock.set('2026-11-07T04:00:00.000Z');
    const sr = await org.tx(desk, (tx) =>
      h.ops.createServiceRequest(tx, {
        propertyId: org.propertyId,
        channel: 'desk',
        category: 'Dinner reservation',
        description: 'Beach dinner for two at 19:30',
        priority: 'high', // due in 30 min
      }),
    );
    h.clock.set('2026-11-07T04:05:00.000Z');
    const started = await org.tx(desk, (tx) =>
      h.ops.transitionTask(tx, sr.task.id, { to: 'in_progress' }, { expectedVersion: sr.task.version }),
    );
    expect(started.nextEscalationAt).toBe('2026-11-07T04:30:00.000Z'); // acknowledgement step passed over
    h.clock.set('2026-11-07T04:20:00.000Z');
    expect((await org.tx(desk, (tx) => h.ops.runEscalations(tx, org.propertyId))).escalated).toEqual([]);
    await org.tx(desk, (tx) =>
      h.ops.transitionTask(tx, sr.task.id, { to: 'done' }, { expectedVersion: started.version }),
    );
    h.clock.set('2026-11-07T06:00:00.000Z');
    expect((await org.tx(desk, (tx) => h.ops.runEscalations(tx, org.propertyId))).escalated).toEqual([]);
  });

  it('a service request is fulfilled only when its task is done — a "done" message changes nothing', async () => {
    const org = await setupOrg(h);
    h.clock.set('2026-11-07T04:00:00.000Z');
    const attendantId = newId();
    const desk = org.as([{ permission: 'operations.task.manage' }]);
    const attendant = org.as(ATTENDANT_GRANTS, { userId: attendantId, displayName: 'Ali' });
    const sr = await org.tx(desk, (tx) =>
      h.ops.createServiceRequest(tx, {
        propertyId: org.propertyId,
        channel: 'messaging',
        category: 'Housekeeping',
        description: 'Please bring an iron',
        departmentKind: 'housekeeping',
        assigneeUserId: attendantId,
      }),
    );
    // Someone replies "done" in the conversation: a comment, not a completion.
    await org.tx(attendant, (tx) => h.ops.commentTask(tx, sr.task.id, { text: 'done', attachments: [] }));
    expect((await org.tx(desk, (tx) => h.ops.getServiceRequest(tx, sr.id))).status.serviceRequest).toBe(
      'open',
    );
    // The request offers its task's next actions; there is no separate "close request" shortcut.
    expect(sr.allowedActions.map((a) => a.action)).not.toContain('closeRequest');
    const done = await org.tx(attendant, (tx) =>
      h.ops.transitionTask(tx, sr.task.id, { to: 'done' }, { expectedVersion: sr.task.version }),
    );
    expect(done.status.task).toBe('done');
    const after = await org.tx(desk, (tx) => h.ops.getServiceRequest(tx, sr.id));
    expect(after).toMatchObject({
      status: { serviceRequest: 'fulfilled' },
      fulfilledAt: '2026-11-07T04:00:00.000Z',
    });
    expect(await eventsOf(h, org.tenantId, 'operations.serviceRequest.completed')).toHaveLength(1);
  });

  it('do-not-disturb beyond the policy limit creates one welfare check; the scheduled job finds the property', async () => {
    const org = await setupOrg(h);
    const [villa] = await seedUnits(h, org, [{ number: 'W512' }]);
    if (!villa) throw new Error('unit');
    const attendant = org.as(SUPERVISOR_GRANTS);
    h.clock.set('2026-11-07T04:00:00.000Z');
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.booking.confirmed',
      aggregate: { type: 'booking', id: newId() },
      payload: {
        bookingId: newId(),
        stays: [{ stayId, unitId: villa, arrival: '2026-11-05', departure: '2026-11-12' }],
      },
    });
    await publish(h, org, {
      type: 'reservations.stay.checkedIn',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId },
    });
    const unit = await org.tx(attendant, (tx) => h.ops.getUnit(tx, villa));
    await org.tx(attendant, (tx) =>
      h.ops.setDnd(tx, villa, { dnd: true }, { expectedVersion: unit.version }),
    );
    h.clock.advance(47 * 60 * MIN);
    await runDueJobs(h.t.db, operationsJobs(h.ports));
    const tasks = () =>
      org.tx(org.admin, (tx) => h.ops.listTasks(tx, { propertyId: org.propertyId, limit: 50 }));
    expect((await tasks()).filter((t) => t.title.startsWith('Welfare check'))).toHaveLength(0);
    h.clock.advance(2 * 60 * MIN);
    // The job is claimed once per interval; run escalations directly the second time.
    await org.tx(org.admin, (tx) => h.ops.runEscalations(tx, org.propertyId));
    await org.tx(org.admin, (tx) => h.ops.runEscalations(tx, org.propertyId));
    const welfare = (await tasks()).filter((t) => t.title.startsWith('Welfare check'));
    expect(welfare).toHaveLength(1);
    expect(welfare[0]).toMatchObject({ departmentKind: 'management', priority: 'high', unitId: villa });
  });
});
