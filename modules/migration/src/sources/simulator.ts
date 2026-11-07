/**
 * The PMS simulator as a migration source: a snapshot of the simulated system (read through the integration
 * module's simulator via a port) converted to canonical records. Simulated data only — refused in live.
 */
import type { BookingStatus, ReservationRecord, SourceRecord } from '../domain/records';
import { unitKey } from '../domain/records';
import type { SimulatorSnapshot } from '../ports';

const SIM_STATUS: Record<string, BookingStatus> = {
  CNF: 'confirmed',
  TEN: 'tentative',
  CXL: 'cancelled',
  INH: 'in_house',
  CO: 'departed',
  NS: 'no_show',
};

export function recordsFromSimulator(s: SimulatorSnapshot): SourceRecord[] {
  const file = `simulator:${s.accountId}`;
  const out: SourceRecord[] = [];
  for (const t of s.property.roomTypes)
    out.push({
      dataClass: 'unit_type',
      key: t.code.toUpperCase(),
      payload: {
        code: t.code.toUpperCase(),
        name: t.name,
        maxOccupancy: t.maxOccupancy,
        baseOccupancy: null,
      },
      origin: { file, row: null },
      problems: [],
    });
  for (const r of s.property.rooms)
    out.push({
      dataClass: 'unit',
      key: unitKey(r.number),
      payload: { number: r.number, unitTypeCode: r.roomTypeCode.toUpperCase(), name: null },
      origin: { file, row: null },
      problems: [],
    });
  for (const p of s.property.ratePlans)
    out.push({
      dataClass: 'rate_plan',
      key: p.code.toUpperCase(),
      payload: { code: p.code.toUpperCase(), name: p.name, currency: s.property.currency },
      origin: { file, row: null },
      problems: [],
    });
  const guests = new Map<string, string>();
  for (const r of s.reservations) {
    const name = r.guestName.trim();
    const guestKey = `sim-guest:${name.toLowerCase()}`;
    guests.set(guestKey, name);
    const status = SIM_STATUS[r.status];
    const payload: ReservationRecord | null = status
      ? {
          status,
          sourceStatus: r.status,
          arrival: r.arrival,
          departure: r.departure,
          unitTypeCode: r.roomTypeCode.toUpperCase(),
          unitNumber: null,
          guestKey,
          guestName: name,
          adults: r.adults,
          children: 0,
          ratePlanCode: r.ratePlanCode.toUpperCase(),
          currency: r.currency,
          nightly: null,
          roomTotalMinor: r.totalMinor,
          taxes: [],
          taxInclusive: true,
          totalMinor: r.totalMinor,
          channel: null,
          guarantee: 'unknown',
        }
      : null;
    out.push({
      dataClass: 'reservation',
      key: r.reservationId,
      payload,
      ...(payload ? {} : { raw: { status: r.status } }),
      origin: { file, row: null },
      problems: payload
        ? []
        : [
            {
              code: 'status_unmapped',
              severity: 'blocking',
              field: 'status',
              message: `Simulator status "${r.status}" is not known.`,
            },
          ],
    });
  }
  for (const [key, name] of guests) {
    const parts = name.split(/\s+/);
    out.push({
      dataClass: 'guest',
      key,
      payload: {
        givenName: parts.length > 1 ? parts.slice(0, -1).join(' ') : null,
        familyName: parts[parts.length - 1] ?? name,
        email: null,
        phone: null,
        nationality: null,
        dateOfBirth: null,
        language: null,
        marketingConsent: null,
      },
      origin: { file, row: null },
      problems: [],
    });
  }
  return out;
}
