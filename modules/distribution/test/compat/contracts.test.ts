/**
 * Compatibility with the REAL providers and producers (self-check item 20): modules may not import each other in
 * src, so distribution declares its own port and event shapes; these tests pin them to the providers' exported
 * types and schemas, at compile time (tsc) and at run time.
 */

import {
  responsibleParty as integrationResponsibleParty,
  severity as integrationSeverity,
} from '@portico/integration/contracts';
import type { AvailabilityChangedPayload } from '@portico/inventory';
import type { PricesChangedPayload, RestrictionsChangedPayload } from '@portico/rates';
import { restrictionKind } from '@portico/rates/contracts';
import type { ReservationsService } from '@portico/reservations';
import { canonicalChannelBooking } from '@portico/reservations/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { responsibleParty, severity } from '../../src/contracts';
import { UNPUBLISHED_RESTRICTIONS } from '../../src/domain/ari';
import { type HubRevision, translateRevision } from '../../src/domain/revisions';
import {
  availabilityChangedPayload,
  pricesChangedPayload,
  restrictionsChangedPayload,
} from '../../src/events';
import type { ReservationsPort } from '../../src/ports';

// ── compile-time: the composition binding type-checks against the real reservations service ──
export function bindReservations(service: ReservationsService): ReservationsPort {
  return { ingestChannelBooking: (tx, input) => service.ingestChannelBooking(tx, input) };
}
// ── compile-time: producer payload interfaces are accepted by distribution's parsers ──
export const _availability: z.input<typeof availabilityChangedPayload> = {} as AvailabilityChangedPayload;
export const _prices: z.input<typeof pricesChangedPayload> = {} as PricesChangedPayload;
export const _restrictions: z.input<typeof restrictionsChangedPayload> = {} as RestrictionsChangedPayload;

const base: HubRevision = {
  revisionId: 'r',
  bookingId: 'b',
  externalPropertyId: 'p',
  status: 'new',
  insertedAt: '2026-11-07T06:00:00Z',
  otaName: 'Agoda',
  otaReservationCode: 'A-1',
  currency: 'USD',
  customer: {
    firstName: 'Ahmed',
    lastName: 'Rasheed',
    email: 'a@example.mv',
    phone: '+960 777 0000',
    country: 'MV',
  },
  rooms: [
    {
      roomRef: '1',
      channelRoomTypeId: 'RT',
      channelRatePlanId: 'RP',
      checkin: '2026-12-01',
      checkout: '2026-12-03',
      adults: 2,
      childrenAges: [3, 12],
      nightly: [
        { date: '2026-12-01', amountMinor: 30000 },
        { date: '2026-12-02', amountMinor: 30000 },
      ],
    },
  ],
  notes: 'Vegetarian',
  paymentCollect: 'property',
};
const mapping = {
  rooms: new Map([['RT', '01a1b4a0-0000-7000-8000-000000000001']]),
  rates: new Map([
    [
      'RP',
      {
        unitTypeId: '01a1b4a0-0000-7000-8000-000000000001',
        ratePlanId: '01a1b4a0-0000-7000-8000-000000000002',
      },
    ],
  ]),
  fallbackRatePlanId: null,
};

describe('distribution ↔ reservations: every translated booking passes the REAL canonical schema', () => {
  const variants: Array<[string, Partial<HubRevision>]> = [
    ['complete', {}],
    ['modified', { status: 'modified' }],
    ['cancelled', { status: 'cancelled' }],
    ['no customer', { customer: null }],
    [
      'junk contact data',
      { customer: { firstName: '', lastName: '  ', email: 'nope', phone: '   ', country: 'Maldives' } },
    ],
    [
      'very long names and notes',
      {
        customer: {
          firstName: 'x'.repeat(300),
          lastName: 'y'.repeat(300),
          email: null,
          phone: '9'.repeat(80),
          country: null,
        },
        notes: 'n'.repeat(5000),
      },
    ],
    ['ota collects', { paymentCollect: 'ota' }],
    [
      'many adults and odd ages',
      {
        rooms: [
          {
            ...(base.rooms[0] as HubRevision['rooms'][number]),
            adults: 40,
            childrenAges: [-1, 0, 17, 18, 2.5],
          },
        ],
      },
    ],
  ];
  for (const [name, over] of variants) {
    it(name, () => {
      const t = translateRevision(
        { ...base, ...over },
        { propertyId: '01a1b4a0-0000-7000-8000-000000000003', amountsIncludeTax: false, mapping },
      );
      expect(t.ok).toBe(true);
      if (t.ok) expect(() => canonicalChannelBooking.parse(t.payload)).not.toThrow();
    });
  }
});

describe('event payloads from the producers parse', () => {
  it('inventory.availability.changed and rates.prices/restrictions.changed', () => {
    const a: AvailabilityChangedPayload = {
      propertyId: '01a1b4a0-0000-7000-8000-000000000003',
      unitTypeId: '01a1b4a0-0000-7000-8000-000000000001',
      range: { from: '2026-12-01', to: '2026-12-02' },
      coalesceKey: 'k',
      cause: 'hold',
    };
    expect(availabilityChangedPayload.parse(a)).toMatchObject(a);
    const r: RestrictionsChangedPayload = {
      propertyId: a.propertyId,
      changeSetId: 'x',
      ratePlanIds: [null],
      unitTypeIds: [null],
      ranges: [a.range],
    };
    expect(restrictionsChangedPayload.parse(r)).toMatchObject(r);
    const p: PricesChangedPayload = {
      propertyId: a.propertyId,
      changeSetId: 'x',
      ratePlanIds: [],
      unitTypeIds: [],
      ranges: [a.range],
    };
    expect(pricesChangedPayload.parse(p)).toMatchObject(p);
  });
});

describe('shared vocabularies are identical to their owners (FOUNDATION_REQUESTS FR-1 asks for kernel homes)', () => {
  it('severity and responsible party equal the integration module’s', () => {
    expect(severity.options).toEqual(integrationSeverity.options);
    expect(responsibleParty.options).toEqual(integrationResponsibleParty.options);
  });
  it('every rates restriction kind is either published or listed as not published (none silently dropped)', () => {
    const published = ['closed', 'closedToArrival', 'closedToDeparture', 'minLos', 'minLosThrough', 'maxLos'];
    for (const k of restrictionKind.options) expect([...published, ...UNPUBLISHED_RESTRICTIONS]).toContain(k);
  });
});

describe('role templates (identity) grant the distribution permissions the spec expects', () => {
  it('revenue manager manages channels; reservations agents read and recover channel bookings', async () => {
    const { ROLE_TEMPLATES } = await import('@portico/identity');
    const { distributionManifest } = await import('../../src/manifest');
    const keys = distributionManifest.permissions.map((p) => p.key);
    const grants = (role: string) => ROLE_TEMPLATES.find((t) => t.key === role)?.permissions ?? [];
    const holds = (role: string, key: string) =>
      grants(role).some(
        (g) => g === key || g === '*' || (g.endsWith('.*') && key.startsWith(g.slice(0, -1))),
      );
    for (const k of keys) expect(holds('revenue_manager', k)).toBe(true);
    expect(holds('reservations_agent', 'distribution.channel.read')).toBe(true);
    expect(holds('reservations_agent', 'distribution.reservation.recover')).toBe(true);
    expect(holds('reservations_agent', 'distribution.connection.manage')).toBe(false);
    expect(holds('front_desk', 'distribution.reservation.recover')).toBe(false);
  });
});
