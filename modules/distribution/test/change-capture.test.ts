/**
 * Change capture never drops an event silently (review P2-8). An event Portico cannot read raises an urgent
 * exception on every publishing connection of the property and marks it fully dirty for the kind (current values
 * are re-sent); a property without a publishing connection raises nothing; an event without even a property fails
 * its delivery (retried, then dead-lettered — visible in the outbox).
 */
import { sql, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as svc from '../src/services';
import { connect, type Harness, type Org, runFor, setupOrg, startHarness, sys } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const emit = (org: Org, type: string, propertyId: string | null, payload: Record<string, unknown>) =>
  withTenantTx(h.t.db, sys(org), (tx) =>
    tx.emit({ type, propertyId, aggregate: { type: 'test', id: newId() }, payload }),
  );

describe('unreadable change events (P2-8)', () => {
  it('an unreadable availability event raises an urgent exception and re-sends the whole kind', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 5_000);
    // A producer changed its format: the unit type field is missing.
    await emit(org, 'inventory.availability.changed', org.propertyId, {
      propertyId: org.propertyId,
      range: { from: '2026-11-10', to: '2026-11-11' },
    });
    await h.drain();
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.find((e) => e.code === 'change_event_unreadable')).toMatchObject({
      severity: 'urgent',
      responsibleParty: 'monoclay',
    });
    const dirty = await org.run((tx) =>
      sql<{ kind: string; n: number }>`select kind, count(*)::int as n from distribution.ari_dirty
        where connection_id = ${c.connectionId}::uuid group by kind`.execute(tx.db),
    );
    // Every mapped room type, the whole window, availability only.
    expect(dirty.rows).toEqual([{ kind: 'availability', n: 2 }]);
  });

  it('a property without a publishing connection raises nothing; an event without any property fails visibly', async () => {
    const org = await setupOrg(h); // no connection
    await emit(org, 'rates.prices.changed', org.propertyId, { propertyId: org.propertyId });
    await emit(org, 'rates.prices.changed', null, { nonsense: true });
    await h.drain();
    const rows = await sql<{
      status: string;
      last_error: string | null;
      type: string;
      property_id: string | null;
    }>`
      select d.status, d.last_error, o.type, o.property_id from core.event_deliveries d
        join core.outbox o on o.id = d.event_id
       where o.tenant_id = ${org.tenantId}::uuid and d.consumer = 'distribution.ari.capture'`.execute(
      h.t.admin.kysely,
    );
    const withProperty = rows.rows.find((r) => r.property_id !== null);
    const without = rows.rows.find((r) => r.property_id === null);
    expect(withProperty?.status).toBe('done');
    expect(without?.status).not.toBe('done');
    expect(without?.last_error).toContain('without a property');
  });
});
