/**
 * F9: the system of record for charges, payments, accounting and availability moves only with a second person's
 * approval (platform authority transitions); integration reports pending forwarded work to the platform guard.
 * F15: records held while a system of record was being switched are applied once the switch takes effect.
 */

import { BusinessRuleError } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIntegrationProvider, integration, integrationSubscriptions } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('activation and second approval (F9)', () => {
  it('plans a transition for charges instead of changing it; other domains change at activation', async () => {
    const org = await setupOrg(h);
    const { conn, preview } = await activeSimulatorConnection(h, org);
    const byDomain = new Map(preview.authorityChanges.map((c) => [c.domain, c]));
    expect(byDomain.get('charges')?.requiresSecondApproval).toBe(true);
    expect(byDomain.get('charges')?.explanation).toMatch(/second manager approves/);
    expect(byDomain.get('reservations')?.requiresSecondApproval).toBe(false);
    expect(preview.warnings.join(' ')).toMatch(/a second manager must approve it/);

    const plannedHere = h.planned.filter((p) => p.propertyId === org.propertyId);
    expect(plannedHere).toHaveLength(1);
    expect(plannedHere[0]?.changes).toEqual([
      {
        domain: 'charges',
        authority: 'external',
        connectionId: conn.id,
        systemName: expect.any(String),
        writeMode: 'forward',
      },
    ]);
    const charges = await tx(h, org.ctx, (t) => platform.getDataAuthority(t, org.propertyId, 'charges'));
    expect(charges.authority).toBe('portico');
    const reservations = await tx(h, org.ctx, (t) =>
      platform.getDataAuthority(t, org.propertyId, 'reservations'),
    );
    expect(reservations).toMatchObject({ authority: 'external', connectionId: conn.id });
  });

  it('without platform transitions, a refusal to move charges is explained, and nothing is half-activated', async () => {
    const org = await setupOrg(h);
    const { plan: _omit, ...withoutPlan } = h.deps.ports.transitions;
    const deps = {
      ...h.deps,
      ports: {
        ...h.deps.ports,
        transitions: withoutPlan,
        platform: {
          ...h.deps.ports.platform,
          async setDataAuthority(
            t: Parameters<typeof h.deps.ports.platform.setDataAuthority>[0],
            input: Parameters<typeof h.deps.ports.platform.setDataAuthority>[1],
          ) {
            if (input.domain === 'charges')
              throw new BusinessRuleError('second_approval_required', 'needs a second approver');
            return h.deps.ports.platform.setDataAuthority(t, input);
          },
        },
      },
    };
    await expect(activeSimulatorConnection({ ...h, deps }, org)).rejects.toMatchObject({
      code: 'second_approval_required',
      message: expect.stringMatching(/second manager.s approval.*Remove .* from the system-of-record scope/),
    });
    const reservations = await tx(h, org.ctx, (t) =>
      platform.getDataAuthority(t, org.propertyId, 'reservations'),
    );
    expect(reservations.authority).toBe('portico');
  });

  it('reports pending forwarded actions to the platform transition guard (ST-08)', async () => {
    const org = await setupOrg(h);
    const { conn } = await activeSimulatorConnection(h, org);
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        workflow: 'charges',
        operation: 'create',
        idempotencyKey: 'folio-posting:G1',
        payload: { reservationId: 'R1001', chargeCode: 'FNB', amountMinor: 4500, currency: 'USD' },
      }),
    );
    const provider = createIntegrationProvider(h.deps);
    const pending = await tx(h, org.ctx, (t) => provider.pendingOperations(t, org.propertyId, ['charges']));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ref).toMatch(/^integration_outbound_command:/);
    expect(pending[0]?.description).toMatch(/queued/);
    expect(
      await tx(h, org.ctx, (t) => provider.pendingOperations(t, org.propertyId, ['roomStatus'])),
    ).toEqual([]);
    const other = await setupOrg(h);
    expect(await tx(h, other.ctx, (t) => provider.pendingOperations(t, org.propertyId, ['charges']))).toEqual(
      [],
    );
  });
});

describe('records held during a change of system of record (F15)', () => {
  it('are applied when the platform reports the switch took effect', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    const key = `${org.propertyId}:reservations`;
    h.transitions.set(key, 'frozen');
    try {
      await account.createReservation(h.clock.now(), { reservationId: 'SW1' });
      await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
        trigger: 'manual',
        workflow: 'reservations',
      });
    } finally {
      h.transitions.delete(key);
    }
    expect(h.applied.some((r) => r.connectionId === conn.id && r.externalId === 'SW1')).toBe(false);
    const consumer = integrationSubscriptions(h.deps).find(
      (s) => s.consumer === 'integration.authority.reprocess',
    );
    expect(consumer?.types).toContain('platform.authorityTransition.completed');
    await tx(h, org.ctx, (t) =>
      (consumer as NonNullable<typeof consumer>).handle(t, {
        id: 'e1',
        type: 'platform.authorityTransition.completed',
        tenantId: org.tenantId,
        propertyId: org.propertyId,
        occurredAt: h.clock.now().toISOString(),
        aggregate: { type: 'authority_transition', id: 't1' },
        payload: { transitionId: 't1', domains: ['reservations'] },
      } as never),
    );
    expect(
      h.applied.filter((r) => r.connectionId === conn.id && r.externalId === 'SW1').map((r) => r.revision),
    ).toHaveLength(1);
  });
});
