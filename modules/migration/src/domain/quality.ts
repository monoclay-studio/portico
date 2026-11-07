/**
 * Phase M2 quality checks across records (docs/adoption/migration-acceptance-criteria.md §4). Pure: returns the
 * problems per record. Blocking problems keep that record out of the import until an exception owner resolves them;
 * warnings are imported and listed. Nothing is merged or corrected automatically.
 */
import { eachNight, type LocalDate } from '@portico/kernel';
import {
  CONSUMING_STATUSES,
  type DataClass,
  type DepositRecord,
  type GuestRecord,
  type InHouseBalanceRecord,
  type Problem,
  type ReservationRecord,
  type SourceRecord,
} from './records';

export interface QualityContext {
  /** The property's current business date (future vs in-house vs history). */
  businessDate: LocalDate;
  /** Unit type codes that resolve to a Portico unit type (from the source pack or reviewed mapping). */
  knownUnitTypes: ReadonlySet<string>;
  /** Units per unit type code (overbooking check). */
  unitsPerType: ReadonlyMap<string, number>;
}

export type QualityFindings = Map<string, Problem[]>;

export const recordId = (dataClass: DataClass, key: string) => `${dataClass}:${key}`;

const add = (out: QualityFindings, id: string, p: Problem) => {
  const list = out.get(id) ?? [];
  if (!list.some((x) => x.code === p.code)) list.push(p);
  out.set(id, list);
};

export function checkQuality(records: readonly SourceRecord[], ctx: QualityContext): QualityFindings {
  const out: QualityFindings = new Map();
  const of = <C extends DataClass>(c: C) =>
    records.filter((r): r is SourceRecord<C> => r.dataClass === c && r.payload !== null);

  // Duplicate source keys in one extract: ambiguous unless identical.
  const byId = new Map<string, SourceRecord[]>();
  for (const r of records) {
    const id = recordId(r.dataClass, r.key);
    byId.set(id, [...(byId.get(id) ?? []), r]);
  }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    const distinct = new Set(list.map((r) => JSON.stringify(r.payload)));
    if (distinct.size > 1)
      add(out, id, {
        code: 'duplicate_key_conflict',
        severity: 'blocking',
        message: `${list.length} rows share this identifier with different content (${list
          .map((r) => `${r.origin.file} row ${r.origin.row}`)
          .join(', ')}). Keep one row in the export and upload it again.`,
      });
  }

  const reservations = of('reservation');
  const resByKey = new Map(reservations.map((r) => [r.key, r.payload as ReservationRecord]));

  // Channel booking id used twice (FIDI failure mode: duplicated reservations).
  const byChannelId = new Map<string, string[]>();
  for (const r of reservations) {
    const p = r.payload as ReservationRecord;
    if (!p.channel) continue;
    const k = `${p.channel.code.toLowerCase()}:${p.channel.bookingId}`;
    byChannelId.set(k, [...(byChannelId.get(k) ?? []), r.key]);
  }
  for (const [k, keys] of byChannelId) {
    if (keys.length < 2) continue;
    for (const key of keys)
      add(out, recordId('reservation', key), {
        code: 'duplicate_channel_booking',
        severity: 'blocking',
        message: `Channel booking ${k.split(':')[1]} appears on ${keys.length} reservations (${keys.join(', ')}). Importing both would duplicate the booking; decide which one is real.`,
      });
  }

  const unitNights = new Map<string, Array<{ key: string; nights: Set<LocalDate> }>>();
  const soldPerTypeNight = new Map<string, number>();
  for (const r of reservations) {
    const p = r.payload as ReservationRecord;
    const id = recordId('reservation', r.key);
    if (!ctx.knownUnitTypes.has(p.unitTypeCode))
      add(out, id, {
        code: 'unit_type_unmapped',
        severity: 'blocking',
        field: 'unit_type_code',
        message: `Unit type ${p.unitTypeCode} is not in the property setup or the reviewed mapping. Add or map it in the mapping step.`,
      });
    if (p.departure <= p.arrival) continue;
    const active = CONSUMING_STATUSES.has(p.status);
    if (active && p.status !== 'in_house' && p.departure <= ctx.businessDate)
      add(out, id, {
        code: 'future_stay_in_past',
        severity: 'blocking',
        message: `The booking is ${p.status} but its stay ended on ${p.departure}, before the business date ${ctx.businessDate}. Check it in the source (no-show, checked out or cancelled?).`,
      });
    if (p.status === 'in_house' && (p.arrival > ctx.businessDate || p.departure <= ctx.businessDate))
      add(out, id, {
        code: 'in_house_dates',
        severity: 'blocking',
        message: `The booking is in house but its stay (${p.arrival} to ${p.departure}) does not include the business date ${ctx.businessDate}.`,
      });
    if (!active) continue;
    const nights = eachNight({ from: p.arrival, to: p.departure });
    for (const n of nights) {
      const k = `${p.unitTypeCode}|${n}`;
      soldPerTypeNight.set(k, (soldPerTypeNight.get(k) ?? 0) + 1);
    }
    if (p.unitNumber) {
      const u = p.unitNumber.toUpperCase();
      unitNights.set(u, [...(unitNights.get(u) ?? []), { key: r.key, nights: new Set(nights) }]);
    }
    if (p.guarantee === 'deposit' && !records.some((d) => d.dataClass === 'deposit' && d.key === r.key))
      add(out, id, {
        code: 'prepaid_without_deposit',
        severity: 'blocking',
        message:
          'The booking is marked as guaranteed by deposit, but no deposit is listed for it. Finance must confirm whether money was received.',
      });
  }

  // One unit assigned to two overlapping stays.
  for (const [unit, stays] of unitNights) {
    for (let i = 0; i < stays.length; i++)
      for (let j = i + 1; j < stays.length; j++) {
        const a = stays[i] as { key: string; nights: Set<string> };
        const b = stays[j] as { key: string; nights: Set<string> };
        const overlap = [...a.nights].find((n) => b.nights.has(n));
        if (!overlap) continue;
        for (const [k, other] of [
          [a.key, b.key],
          [b.key, a.key],
        ] as const)
          add(out, recordId('reservation', k), {
            code: 'unit_double_assigned',
            severity: 'blocking',
            field: 'unit_number',
            message: `Unit ${unit} is assigned to this booking and to ${other} on ${overlap}. A reservations manager must decide which stay keeps the unit.`,
          });
      }
  }

  // More active stays than units on a night: imported as an inventory conflict, never silently.
  for (const [k, sold] of soldPerTypeNight) {
    const [type, night] = k.split('|') as [string, string];
    const units = ctx.unitsPerType.get(type);
    if (units === undefined || sold <= units) continue;
    for (const r of reservations) {
      const p = r.payload as ReservationRecord;
      if (p.unitTypeCode !== type || !CONSUMING_STATUSES.has(p.status)) continue;
      if (!(p.arrival <= night && night < p.departure)) continue;
      add(out, recordId('reservation', r.key), {
        code: 'overbooked_in_source',
        severity: 'warning',
        message: `${sold} stays of ${type} on ${night} but only ${units} units. It is imported and shown as an inventory conflict for the reservations manager.`,
      });
    }
  }

  for (const r of of('deposit')) {
    const d = r.payload as DepositRecord;
    const id = recordId('deposit', r.key);
    const booking = resByKey.get(d.bookingKey);
    if (!booking)
      add(out, id, {
        code: 'deposit_without_booking',
        severity: 'blocking',
        message: `Deposit for booking ${d.bookingKey}, which is not in the reservations export. Finance must decide where this money belongs.`,
      });
    else if (booking.currency !== d.currency)
      add(out, id, {
        code: 'deposit_currency_mismatch',
        severity: 'blocking',
        message: `The deposit is in ${d.currency} but the booking is in ${booking.currency}. Currencies are never converted during migration.`,
      });
    else if (!CONSUMING_STATUSES.has(booking.status))
      add(out, id, {
        code: 'deposit_on_inactive_booking',
        severity: 'warning',
        message: `The booking is ${booking.status} but still holds a deposit. It is imported as held; finance decides on refund or forfeit.`,
      });
    if (d.amountMinor <= 0)
      add(out, id, {
        code: 'deposit_not_positive',
        severity: 'blocking',
        message:
          'A held deposit must be positive. Check the source for refunds or overdrafts on this booking.',
      });
  }

  const inHouseWithBalance = new Set<string>();
  for (const r of of('in_house_balance')) {
    const b = r.payload as InHouseBalanceRecord;
    const id = recordId('in_house_balance', r.key);
    inHouseWithBalance.add(b.bookingKey);
    const booking = resByKey.get(b.bookingKey);
    if (!booking || booking.status !== 'in_house')
      add(out, id, {
        code: 'balance_without_in_house_stay',
        severity: 'blocking',
        message: `An open folio balance for ${b.bookingKey}, which is not an in-house booking in the export. Finance must confirm it.`,
      });
    else if (booking.currency !== b.currency)
      add(out, id, {
        code: 'balance_currency_mismatch',
        severity: 'blocking',
        message: `The folio is in ${b.currency} but the booking is in ${booking.currency}.`,
      });
  }
  for (const r of reservations) {
    const p = r.payload as ReservationRecord;
    if (p.status === 'in_house' && !inHouseWithBalance.has(r.key))
      add(out, recordId('reservation', r.key), {
        code: 'in_house_without_balance',
        severity: 'warning',
        message:
          'The guest is in house but no open folio balance is listed. The stay is imported with no opening folio balance; finance confirms this in the opening-balance sign-off.',
      });
  }

  // Possible duplicate guest profiles (flagged, never merged — M2, MG-05).
  const guests = of('guest');
  const byEmail = new Map<string, string[]>();
  const byNameDob = new Map<string, string[]>();
  for (const r of guests) {
    const g = r.payload as GuestRecord;
    if (g.email) byEmail.set(g.email, [...(byEmail.get(g.email) ?? []), r.key]);
    if (g.dateOfBirth) {
      const k = `${g.familyName.toLowerCase()}|${(g.givenName ?? '').toLowerCase()}|${g.dateOfBirth}`;
      byNameDob.set(k, [...(byNameDob.get(k) ?? []), r.key]);
    }
  }
  for (const [reason, groups] of [
    ['same email', byEmail],
    ['same name and date of birth', byNameDob],
  ] as const)
    for (const keys of groups.values()) {
      if (keys.length < 2) continue;
      for (const k of keys)
        add(out, recordId('guest', k), {
          code: 'possible_duplicate_profile',
          severity: 'warning',
          message: `Possible duplicate of ${keys.filter((x) => x !== k).join(', ')} (${reason}). Both are imported; merging is a reviewed, reversible decision after the migration.`,
        });
    }
  return out;
}
