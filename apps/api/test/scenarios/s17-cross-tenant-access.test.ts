/**
 * S17 — A user tries to access another hotel customer's records: direct ids over HTTP, search, records history,
 * reports, and a forged tenant context at the database level. Every attempt answers 404 / nothing, with no
 * existence leak. (Extends the foundation isolation test with the composed modules.)
 */
import { sql, withTenantTx } from '@portico/db';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  kandu,
  organization,
  type Scenario,
  signIn,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S17 — cross-tenant access', () => {
  it("organization B gets 404 for A's booking, stay, guest, folio, unit, history and search, and zero rows under RLS", async () => {
    const a = await organization(s, { name: 'Org A' });
    const ka = await kandu(s, a);
    const agent = a.staff('front_desk', 'Desk A', [ka.id]);
    const booking = applied<Booking>(
      await a.run(agent, (tx) =>
        s.c.services.reservations.createBooking(
          tx,
          bookingInput(ka, {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            guest: { firstName: 'Svetlana', lastName: 'Orlova' },
          }),
        ),
      ),
    );
    const stay = booking.stays[0];
    const profileId = stay?.occupants[0]?.profileId as string;
    const folio = await a.run(a.setup, (tx) =>
      s.c.services.finance.openFolio(tx, {
        propertyId: ka.id,
        owner: { type: 'stay', id: stay?.id as string },
        payer: { type: 'guest', id: profileId },
      }),
    );

    const b = await organization(s, { name: 'Org B' });
    await kandu(s, b);
    const auth = await signIn(s, b);
    const get = (url: string) => s.app.inject({ method: 'GET', url, headers: auth });
    for (const url of [
      `/v1/bookings/${booking.id}`,
      `/v1/stays/${stay?.id}`,
      `/v1/guests/profiles/${profileId}`,
      `/v1/finance/folios/${folio.folioId}`,
      `/v1/inventory/units/${ka.units['214']}`,
      `/v1/properties/${ka.id}`,
      `/v1/records/booking/${booking.id}/history`,
      `/v1/records/folio/${folio.folioId}/history`,
    ]) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(404);
      expect(r.body).not.toContain('Orlova');
    }
    const search = await get('/v1/search?q=Orlova');
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toEqual([]);
    const code = await get(`/v1/search?q=${booking.code}`);
    expect(code.json().items).toEqual([]);
    const tb = await get(`/v1/finance/trial-balance?legalEntityId=${ka.legalEntityId}`);
    expect([403, 404]).toContain(tb.statusCode);

    // Forged tenant context at the database level: B's context reading A's rows sees nothing (RLS forced).
    const rows = await withTenantTx(s.t.db, b.setup, async (tx) => ({
      bookings: (await sql`select id from reservations.bookings where id = ${booking.id}`.execute(tx.db))
        .rows,
      folios: (await sql`select id from finance.folios where id = ${folio.folioId}`.execute(tx.db)).rows,
      profiles: (await sql`select id from guests.profiles where id = ${profileId}`.execute(tx.db)).rows,
      terms: (await sql`select id from reservations.terms_snapshots`.execute(tx.db)).rows,
    }));
    expect(rows).toEqual({ bookings: [], folios: [], profiles: [], terms: [] });
    await assertGlobalConsistency(s, a, { auditActions: ['reservations.booking.create'] });
  });

  it.todo('security log entries for denied cross-tenant attempts (no platform security log yet — wave 2)');
  it.todo(
    'exports, reports beyond finance and webhook replays across tenants (export and replay endpoints not built)',
  );
});
