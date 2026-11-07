/**
 * UX round 1 "wiring" refinements (docs/ux/round-1/summary.md §6): the HTTP surface the backoffice needs exists and
 * answers through the real composition — data authority and policies (INT-03 / SET-05, read side), search over
 * stays and guests incl. partial names and phone fragments with record types the UI knows (NAV-03 / GST-01), and
 * money on the front-desk boards only for roles that handle money (FD-15, proven in reservations' permission test).
 */
import { newId } from '@portico/kernel';
import { dataDomain } from '@portico/platform';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  kandu,
  makeExternal,
  organization,
  type Scenario,
  signIn,
  startScenario,
} from './scenarios/harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('UX round 1 wiring', () => {
  it('data authority and policies are readable over HTTP; a policy change is previewed across properties', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    await makeExternal(s, org, k.id, 'roomStatus', 'forward');
    const auth = await signIn(s, org);
    const da = await s.app.inject({
      method: 'GET',
      url: `/v1/properties/${k.id}/data-authority`,
      headers: auth,
    });
    expect(da.statusCode).toBe(200);
    // One row per data domain platform knows (main added guestCommunications).
    expect(da.json().items).toHaveLength(dataDomain.options.length);
    expect(da.json().items.find((d: { domain: string }) => d.domain === 'roomStatus')).toMatchObject({
      authority: 'external',
      systemName: 'Legacy PMS',
      writeMode: 'forward',
    });
    const pol = await s.app.inject({
      method: 'GET',
      url: `/v1/properties/${k.id}/policies/reservations.checkIn.requiredCondition`,
      headers: auth,
    });
    expect(pol.statusCode).toBe(200);
    expect(pol.json()).toMatchObject({ key: 'reservations.checkIn.requiredCondition', source: 'default' });
    const tenant = await s.app.inject({ method: 'GET', url: '/v1/organization', headers: auth });
    const preview = await s.app.inject({
      method: 'POST',
      url: '/v1/policies/preview',
      headers: auth,
      payload: {
        key: 'reservations.checkIn.requiredCondition',
        scopeType: 'organization',
        scopeId: tenant.json().id,
        value: 'clean',
        defaultValue: 'inspected',
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().affected.map((a: { propertyId: string }) => a.propertyId)).toContain(k.id);
    // Unauthenticated and other-organization callers learn nothing.
    expect(
      (await s.app.inject({ method: 'GET', url: `/v1/properties/${k.id}/data-authority` })).statusCode,
    ).toBe(401);
    const other = await organization(s, { name: 'Other Group' });
    const otherAuth = await signIn(s, other);
    expect(
      (
        await s.app.inject({
          method: 'GET',
          url: `/v1/properties/${k.id}/data-authority`,
          headers: otherAuth,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('search finds stays and guests by partial name, phone fragment and code; every hit is a known record type', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const agent = org.staff('reservations_agent', 'Aishath', [k.id]);
    const booking = applied<Booking>(
      await org.run(agent, (tx) =>
        s.c.services.reservations.createBooking(tx, {
          ...bookingInput(k, {
            arrival: '2027-03-10',
            departure: '2027-03-12',
            guest: { firstName: 'Anna', lastName: 'Kowalska' },
          }),
          booker: {
            kind: 'profile',
            profile: {
              firstName: 'Anna',
              lastName: 'Kowalska',
              phone: '+960 771 2345',
              email: `anna-${newId()}@example.pl`,
            },
          },
        }),
      ),
    );
    const auth = await signIn(s, org);
    const search = async (q: string) => {
      const r = await s.app.inject({
        method: 'GET',
        url: `/v1/search?q=${encodeURIComponent(q)}`,
        headers: auth,
      });
      expect(r.statusCode).toBe(200);
      return r.json().items as Array<{ type: string; id: string; title: string }>;
    };
    const known = new Set([
      'booking',
      'stay',
      'guest_profile',
      'company',
      'unit',
      'unitType',
      'folio',
      'payment',
    ]);
    for (const q of ['Kowal', 'anna k', '7712', booking.code]) {
      const items = await search(q);
      expect(items.length, `"${q}" finds something`).toBeGreaterThan(0);
      for (const i of items) expect(known.has(i.type), `${q}: ${i.type}`).toBe(true);
    }
    expect((await search('Kowal')).map((i) => i.type)).toEqual(
      expect.arrayContaining(['stay', 'guest_profile']),
    );
    expect((await search('7712')).map((i) => i.type)).toContain('guest_profile');
    expect((await search(booking.code))[0]).toMatchObject({ type: 'booking', id: booking.id });
  });
});
