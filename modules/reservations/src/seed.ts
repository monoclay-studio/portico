import { sql, type TxContext } from '@portico/db';
import { addDays, DomainError } from '@portico/kernel';
import type { NewBookingInput } from './contracts';
import type { ReservationsService } from './service';

/** Structural copy of apps/api's DemoOrganization (modules never import the app). */
export interface DemoOrgShape {
  tenantId: string;
  name: string;
  properties: Array<{ id: string; code: string; profile: string; legalEntityId: string }>;
}

const GUESTS = [
  { firstName: 'Aminath', lastName: 'Shareef', nationality: 'MV' },
  { firstName: 'Lena', lastName: 'Hoffmann', nationality: 'DE' },
  { firstName: 'Kenji', lastName: 'Watanabe', nationality: 'JP' },
  { firstName: 'Priya', lastName: 'Raman', nationality: 'IN' },
  { firstName: 'Oliver', lastName: 'Bennett', nationality: 'GB' },
];

/**
 * Demo seed step (DemoSeedStep-compatible: `(tx, org) => Promise<void>` via `.run`). Creates a small, realistic
 * set of bookings per demo property using the real reservation commands — arrivals today and tomorrow, an
 * in-house-ready walk-in, a tentative option and a family multi-room booking. It discovers unit types and rate
 * plans through the bound inventory/rates ports, and skips quietly where those modules are not installed yet.
 * Demo organizations live in the `demo` environment: nothing real can be charged, keyed or sent.
 */
export function reservationsDemoSeed(service: ReservationsService) {
  return {
    name: 'reservations',
    async run(tx: TxContext, org: DemoOrgShape): Promise<void> {
      const { inventory, rates, platform } = service.deps.ports;
      for (const property of org.properties) {
        try {
          const businessDate = await platform.getBusinessDate(tx, property.id);
          const types = await inventory.listUnitTypes(tx, { propertyId: property.id });
          if (types.length === 0) continue;
          const offers = await rates.quote(tx, {
            propertyId: property.id,
            nights: { from: businessDate, to: addDays(businessDate, 3) },
            occupancy: { adults: 2, childrenAges: [] },
            bookingDate: businessDate,
          });
          const usable = offers.filter((o) => o.restrictionViolations.length === 0);
          if (usable.length === 0) continue;
          const pick = (i: number) => usable[i % usable.length] as (typeof usable)[number];
          const make = (
            i: number,
            arrivalOffset: number,
            nights: number,
            intent: NewBookingInput['intent'],
          ): NewBookingInput => {
            const guest = GUESTS[i % GUESTS.length] as (typeof GUESTS)[number];
            const offer = pick(i);
            return {
              propertyId: property.id,
              intent,
              booker: { kind: 'profile', profile: guest },
              source: i % 2 === 0 ? 'direct_email' : 'booking_engine',
              externalRefs: {},
              marketSegment: 'leisure',
              guarantee: { kind: 'none' },
              specialRequests: i === 0 ? ['Honeymoon setup'] : [],
              tags: ['demo'],
              ...(intent === 'tentative' ? { optionDate: addDays(businessDate, 2) } : {}),
              stays: [
                {
                  unitTypeId: offer.unitTypeId,
                  ratePlanId: offer.ratePlanId,
                  arrival: addDays(businessDate, arrivalOffset),
                  departure: addDays(businessDate, arrivalOffset + nights),
                  occupancy: { adults: 2, childrenAges: [] },
                  commercialType: 'standard',
                  occupants: [{ profile: guest, kind: 'adult', primary: true }],
                  requests: [],
                },
              ],
            };
          };
          const plan: Array<[number, number, number, NewBookingInput['intent']]> = [
            [0, 0, 3, 'confirm'],
            [1, 0, 2, 'confirm'],
            [2, 1, 4, 'confirm'],
            [3, 7, 5, 'tentative'],
            [4, 14, 7, 'confirm'],
          ];
          for (const [i, offset, nights, intent] of plan) {
            // Savepoint per booking: a sold-out sample night skips that booking without leaving partial rows.
            await sql`savepoint demo_booking`.execute(tx.db);
            try {
              await service.createBooking(tx, make(i, offset, nights, intent));
              await sql`release savepoint demo_booking`.execute(tx.db);
            } catch (err) {
              await sql`rollback to savepoint demo_booking`.execute(tx.db);
              if (err instanceof DomainError && err.status === 422) continue;
              throw err;
            }
          }
        } catch (err) {
          // Inventory/rates not installed yet, or sold out in the sample data: leave this property without bookings.
          if (err instanceof DomainError && err.code === 'module_not_available') continue;
          throw err;
        }
      }
    },
  };
}
