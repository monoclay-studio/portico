/**
 * Reconciliation engine (phase M4; DD11 §7.3). Compares the source — its detail records and the control totals it
 * reports — with what Portico ACTUALLY holds (read back from the owning modules, never from what migration thinks
 * it sent). Nothing is called migrated until this report is exact: every record accounted for in exactly one state,
 * every amount equal to the minor unit, every difference listed with its reason. The report is the sign-off artefact.
 */
import { canonicalJson, diffDays, eachNight, type LocalDate, sha256Hex } from '@portico/kernel';
import { RECORD_STATES, type RecordState } from '../vocabulary';
import {
  CONSUMING_STATUSES,
  DATA_CLASSES,
  type DataClass,
  type ReservationRecord,
  type SourceRecord,
} from './records';

export { RECORD_STATES, type RecordState };

export interface LedgerEntry {
  dataClass: DataClass;
  key: string;
  state: RecordState;
  targetId: string | null;
}

export interface PorticoReadBack {
  unitTypes: Array<{ code: string; id: string }>;
  units: Array<{ id: string; number: string; unitTypeId: string }>;
  existingGuestIds: ReadonlySet<string>;
  reservations: Array<{
    sourceKey: string;
    bookingId: string;
    status: string;
    arrival: LocalDate;
    departure: LocalDate;
    unitTypeId: string;
    currency: string;
    roomTotalMinor: number;
    taxTotalMinor: number;
    totalMinor: number;
    nightly: Array<{ date: LocalDate; amountMinor: number }> | null;
  }>;
  /** Units sold per unit type and night, from inventory (all bookings at the property). */
  sold: Array<{ unitTypeId: string; date: LocalDate; sold: number }>;
  deposits: Array<{ bookingId: string; amountMinor: number; currency: string }>;
  inHouse: Array<{ bookingId: string; folioRef: string; balanceMinor: number; currency: string }>;
  receivables: Array<{ accountCode: string; invoiceRef: string; openMinor: number; currency: string }>;
  /** Which read-backs the providers could answer (a missing provider is reported, never assumed equal). */
  unavailable: DataClass[];
}

export interface Difference {
  dataClass: DataClass;
  key: string | null;
  measure: string;
  source: string;
  portico: string;
  message: string;
  /** True when an open exception or decision explains it (listed exclusion), false when unexplained. */
  explained: boolean;
}

export interface AccountingRow {
  dataClass: DataClass;
  source: number;
  states: Record<RecordState, number>;
  unaccounted: number;
}

export interface MeasureRow {
  dataClass: DataClass;
  measure: string;
  currency: string | null;
  source: number;
  portico: number;
  equal: boolean;
}

export interface ControlTotalCheck {
  dataClass: DataClass;
  currency: string | null;
  reported: number | null;
  sourceDetail: number;
  portico: number;
  excluded: number;
  /** reported − portico − excluded (0 means the closing balance is agreed to the minor unit). */
  unexplainedMinor: number | null;
}

export interface ReconciliationResult {
  exact: boolean;
  accounting: AccountingRow[];
  measures: MeasureRow[];
  controlTotals: ControlTotalCheck[];
  differences: Difference[];
  unavailable: DataClass[];
  fingerprint: string;
}

export interface ReconcileInput {
  records: readonly SourceRecord[];
  ledger: readonly LedgerEntry[];
  controlTotals: ReadonlyArray<{
    dataClass: DataClass;
    currency: string | null;
    count: number | null;
    amountMinor: number | null;
  }>;
  portico: PorticoReadBack;
  businessDate: LocalDate;
  /** Classes in this migration's scope (others are not reconciled). */
  scope: ReadonlySet<DataClass>;
  /** Reservation key → Portico unit type id (reviewed mapping). */
  unitTypeIdByCode: ReadonlyMap<string, string>;
}

const emptyStates = (): Record<RecordState, number> =>
  Object.fromEntries(RECORD_STATES.map((s) => [s, 0])) as Record<RecordState, number>;

export function agingBucket(
  due: LocalDate,
  businessDate: LocalDate,
): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  const late = diffDays(due, businessDate);
  if (late <= 0) return 'current';
  if (late <= 30) return '1-30';
  if (late <= 60) return '31-60';
  if (late <= 90) return '61-90';
  return '90+';
}

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const differences: Difference[] = [];
  const measures: MeasureRow[] = [];
  const stateOf = new Map(input.ledger.map((l) => [`${l.dataClass}:${l.key}`, l]));
  const inScope = (c: DataClass) => input.scope.has(c);
  const records = input.records.filter((r) => inScope(r.dataClass));
  const imported = (r: SourceRecord) => {
    const s = stateOf.get(`${r.dataClass}:${r.key}`)?.state;
    return s === 'imported' || s === 'merged';
  };
  const excludedKeys = (c: DataClass) =>
    new Set(records.filter((r) => r.dataClass === c && !imported(r)).map((r) => r.key));

  // ── 1. every record accounted for in exactly one state (MG-08) ──
  const accounting: AccountingRow[] = [];
  for (const c of DATA_CLASSES) {
    if (!inScope(c)) continue;
    const keys = new Set(records.filter((r) => r.dataClass === c).map((r) => r.key));
    const states = emptyStates();
    let unaccounted = 0;
    for (const k of keys) {
      const l = stateOf.get(`${c}:${k}`);
      if (!l) unaccounted++;
      else states[l.state]++;
    }
    accounting.push({ dataClass: c, source: keys.size, states, unaccounted });
    if (unaccounted > 0)
      differences.push({
        dataClass: c,
        key: null,
        measure: 'accounted',
        source: String(keys.size),
        portico: String(keys.size - unaccounted),
        message: `${unaccounted} source record(s) have no recorded outcome yet. Run the import again.`,
        explained: false,
      });
    if (states.pending > 0)
      differences.push({
        dataClass: c,
        key: null,
        measure: 'pending',
        source: String(keys.size),
        portico: String(states.imported + states.merged),
        message: `${states.pending} record(s) are still waiting to be imported.`,
        explained: false,
      });
  }

  // Imported records the source no longer shows (deleted there after the import): never silently kept as truth.
  const present = new Set(records.map((r) => `${r.dataClass}:${r.key}`));
  for (const l of input.ledger) {
    if (!inScope(l.dataClass) || (l.state !== 'imported' && l.state !== 'merged')) continue;
    if (present.has(`${l.dataClass}:${l.key}`)) continue;
    differences.push({
      dataClass: l.dataClass,
      key: l.key,
      measure: 'missing_in_source',
      source: 'absent',
      portico: l.targetId ?? 'imported',
      message: `${l.dataClass.replace(/_/g, ' ')} ${l.key} is in Portico but no longer in the source. Was it deleted there? Cancel it in Portico or explain it.`,
      explained: false,
    });
  }

  const unavailable = input.portico.unavailable.filter(inScope);
  for (const c of unavailable)
    differences.push({
      dataClass: c,
      key: null,
      measure: 'read_back',
      source: 'available',
      portico: 'not available',
      message: `Portico could not read back ${c.replace(/_/g, ' ')} from its owning module, so they cannot be called reconciled.`,
      explained: false,
    });

  const measure = (dataClass: DataClass, name: string, currency: string | null, src: number, por: number) => {
    measures.push({ dataClass, measure: name, currency, source: src, portico: por, equal: src === por });
  };

  // ── 2. property setup: every imported (or mapped) unit type and unit exists in inventory ──
  const setup = (c: 'unit_type' | 'unit', ids: ReadonlySet<string>, noun: string) => {
    if (!inScope(c) || unavailable.includes(c)) return;
    const src = records.filter((r) => r.dataClass === c && imported(r));
    let ok = 0;
    for (const r of src) {
      const target = stateOf.get(`${c}:${r.key}`)?.targetId;
      if (target && ids.has(target)) ok++;
      else
        differences.push({
          dataClass: c,
          key: r.key,
          measure: 'exists',
          source: r.key,
          portico: 'missing',
          message: `${noun} ${r.key} is marked imported but is not in inventory.`,
          explained: false,
        });
    }
    measure(c, 'count', null, src.length, ok);
  };
  setup('unit_type', new Set(input.portico.unitTypes.map((u) => u.id)), 'Unit type');
  setup('unit', new Set(input.portico.units.map((u) => u.id)), 'Unit');

  // ── 3. guests: imported or merged-with-link, and the profile exists ──
  if (inScope('guest') && !unavailable.includes('guest')) {
    let ok = 0;
    for (const r of records.filter((x) => x.dataClass === 'guest' && imported(x))) {
      const l = stateOf.get(`guest:${r.key}`);
      if (l?.targetId && input.portico.existingGuestIds.has(l.targetId)) ok++;
      else
        differences.push({
          dataClass: 'guest',
          key: r.key,
          measure: 'exists',
          source: r.key,
          portico: 'missing',
          message: `Guest ${r.key} is marked imported but the profile cannot be found.`,
          explained: false,
        });
    }
    measure(
      'guest',
      'imported_or_merged',
      null,
      records.filter((x) => x.dataClass === 'guest' && imported(x)).length,
      ok,
    );
  }

  // ── 4. reservations: per booking, counts by status × arrival month, room nights and revenue per stay date ──
  const resBySource = new Map(input.portico.reservations.map((r) => [r.sourceKey, r]));
  if (inScope('reservation') && !unavailable.includes('reservation')) {
    const src = records.filter(
      (r) => r.dataClass === 'reservation' && imported(r),
    ) as SourceRecord<'reservation'>[];
    const countSrc = new Map<string, number>();
    const countPor = new Map<string, number>();
    const revSrc = new Map<string, number>();
    const revPor = new Map<string, number>();
    for (const r of src) {
      const p = r.payload as ReservationRecord;
      const k = `${p.status}|${p.arrival.slice(0, 7)}`;
      countSrc.set(k, (countSrc.get(k) ?? 0) + 1);
      if (p.nightly)
        for (const n of p.nightly)
          revSrc.set(`${p.currency}|${n.date}`, (revSrc.get(`${p.currency}|${n.date}`) ?? 0) + n.amountMinor);
      const por = resBySource.get(r.key);
      if (!por) {
        differences.push({
          dataClass: 'reservation',
          key: r.key,
          measure: 'exists',
          source: r.key,
          portico: 'missing',
          message: `Reservation ${r.key} is marked imported but reservations does not hold it.`,
          explained: false,
        });
        continue;
      }
      const pk = `${por.status}|${por.arrival.slice(0, 7)}`;
      countPor.set(pk, (countPor.get(pk) ?? 0) + 1);
      if (por.nightly)
        for (const n of por.nightly)
          revPor.set(
            `${por.currency}|${n.date}`,
            (revPor.get(`${por.currency}|${n.date}`) ?? 0) + n.amountMinor,
          );
      const taxSrc = p.taxes.reduce((s, t) => s + t.amountMinor, 0);
      const checks: Array<[string, string, string]> = [
        ['status', p.status, por.status],
        ['arrival', p.arrival, por.arrival],
        ['departure', p.departure, por.departure],
        [
          'unit_type',
          input.unitTypeIdByCode.get(p.unitTypeCode) ?? `unmapped:${p.unitTypeCode}`,
          por.unitTypeId,
        ],
        ['currency', p.currency, por.currency],
        ['room_total', String(p.roomTotalMinor), String(por.roomTotalMinor)],
        ['tax_total', String(taxSrc), String(por.taxTotalMinor)],
        ['total', String(p.totalMinor), String(por.totalMinor)],
      ];
      for (const [m, s, q] of checks)
        if (s !== q)
          differences.push({
            dataClass: 'reservation',
            key: r.key,
            measure: m,
            source: s,
            portico: q,
            message: `Reservation ${r.key}: ${m.replace('_', ' ')} is ${s} in the source and ${q} in Portico.`,
            explained: false,
          });
    }
    for (const k of new Set([...countSrc.keys(), ...countPor.keys()])) {
      const [status, month] = k.split('|');
      measure(
        'reservation',
        `count ${status} arriving ${month}`,
        null,
        countSrc.get(k) ?? 0,
        countPor.get(k) ?? 0,
      );
    }
    for (const k of new Set([...revSrc.keys(), ...revPor.keys()])) {
      const [currency, date] = k.split('|') as [string, string];
      const s = revSrc.get(k) ?? 0;
      const q = revPor.get(k) ?? 0;
      if (s !== q)
        differences.push({
          dataClass: 'reservation',
          key: null,
          measure: `revenue ${date}`,
          source: String(s),
          portico: String(q),
          message: `Room revenue on the books for ${date} is ${s} in the source and ${q} in Portico (${currency} minor units).`,
          explained: false,
        });
    }
    const totalRev = (m: Map<string, number>, cur: string) =>
      [...m].filter(([k]) => k.startsWith(`${cur}|`)).reduce((s, [, v]) => s + v, 0);
    for (const cur of new Set([...revSrc.keys()].map((k) => k.split('|')[0] as string)))
      measure('reservation', 'room revenue on the books', cur, totalRev(revSrc, cur), totalRev(revPor, cur));

    // Room nights per unit type and night from the business date: source consuming stays vs inventory sold.
    const nightsSrc = new Map<string, number>();
    for (const r of records.filter((x) => x.dataClass === 'reservation' && x.payload)) {
      const p = r.payload as ReservationRecord;
      if (!CONSUMING_STATUSES.has(p.status)) continue;
      const typeId = input.unitTypeIdByCode.get(p.unitTypeCode);
      if (!typeId) continue;
      const excluded = !imported(r);
      for (const n of eachNight({ from: p.arrival, to: p.departure })) {
        if (n < input.businessDate) continue;
        const k = `${typeId}|${n}`;
        if (!excluded) nightsSrc.set(k, (nightsSrc.get(k) ?? 0) + 1);
      }
    }
    const nightsPor = new Map(input.portico.sold.map((s) => [`${s.unitTypeId}|${s.date}`, s.sold]));
    let srcSum = 0;
    let porSum = 0;
    for (const k of new Set([
      ...nightsSrc.keys(),
      ...[...nightsPor.keys()].filter((x) => (nightsPor.get(x) ?? 0) > 0),
    ])) {
      const s = nightsSrc.get(k) ?? 0;
      const q = nightsPor.get(k) ?? 0;
      srcSum += s;
      porSum += q;
      if (s !== q) {
        const [, date] = k.split('|') as [string, string];
        differences.push({
          dataClass: 'reservation',
          key: null,
          measure: `room_nights ${date}`,
          source: String(s),
          portico: String(q),
          message: `Rooms sold on ${date} for one unit type: ${s} in the source, ${q} in Portico inventory${q > s ? ' (bookings made in Portico after the switch count here)' : ''}.`,
          explained: false,
        });
      }
    }
    measure('reservation', 'room nights from the business date', null, srcSum, porSum);
  }

  // ── 5. money: deposits, in-house balances, receivables — per item, per currency, against control totals ──
  const resvTarget = (bookingKey: string) => stateOf.get(`reservation:${bookingKey}`)?.targetId ?? null;
  const moneyClass = (
    c: 'deposit' | 'in_house_balance' | 'ar_open_item',
    items: Array<{
      key: string;
      amount: number;
      currency: string;
      excluded: boolean;
      portico: number | null;
    }>,
  ) => {
    const currencies = new Set(items.map((i) => i.currency));
    for (const cur of currencies) {
      const list = items.filter((i) => i.currency === cur);
      const detail = list.reduce((s, i) => s + i.amount, 0);
      const excluded = list.filter((i) => i.excluded).reduce((s, i) => s + i.amount, 0);
      const portico = list.filter((i) => !i.excluded).reduce((s, i) => s + (i.portico ?? 0), 0);
      measure(c, 'total held', cur, detail - excluded, portico);
      const reported = input.controlTotals.find((t) => t.dataClass === c && t.currency === cur);
      const check: ControlTotalCheck = {
        dataClass: c,
        currency: cur,
        reported: reported?.amountMinor ?? null,
        sourceDetail: detail,
        portico,
        excluded,
        unexplainedMinor:
          reported?.amountMinor === null || !reported ? null : reported.amountMinor - portico - excluded,
      };
      controlTotals.push(check);
      if (check.unexplainedMinor !== null && check.unexplainedMinor !== 0)
        differences.push({
          dataClass: c,
          key: null,
          measure: 'closing_balance',
          source: String(reported?.amountMinor),
          portico: String(portico),
          message: `The closing balance the source reports (${reported?.amountMinor} ${cur} minor units) differs from Portico's opening balance (${portico}) plus listed exclusions (${excluded}) by ${check.unexplainedMinor}. Finance must explain the difference; it is never plugged.`,
          explained: false,
        });
      if (excluded > 0)
        differences.push({
          dataClass: c,
          key: null,
          measure: 'excluded',
          source: String(excluded),
          portico: '0',
          message: `${excluded} ${cur} minor units are held back by open exceptions (listed exclusions).`,
          explained: true,
        });
    }
    for (const i of items)
      if (!i.excluded && i.portico !== i.amount)
        differences.push({
          dataClass: c,
          key: i.key,
          measure: 'amount',
          source: String(i.amount),
          portico: i.portico === null ? 'missing' : String(i.portico),
          message: `${c.replace(/_/g, ' ')} ${i.key}: ${i.amount} in the source, ${i.portico ?? 'nothing'} in Portico (${i.currency} minor units).`,
          explained: false,
        });
  };
  const controlTotals: ControlTotalCheck[] = [];
  if (inScope('deposit') && !unavailable.includes('deposit')) {
    const ex = excludedKeys('deposit');
    const dep = new Map(input.portico.deposits.map((d) => [d.bookingId, d]));
    moneyClass(
      'deposit',
      records
        .filter((r) => r.dataClass === 'deposit' && r.payload)
        .map((r) => {
          const p = r.payload as { bookingKey: string; amountMinor: number; currency: string };
          const bid = resvTarget(p.bookingKey);
          const d = bid ? dep.get(bid) : undefined;
          return {
            key: r.key,
            amount: p.amountMinor,
            currency: p.currency,
            excluded: ex.has(r.key),
            portico: d && d.currency === p.currency ? d.amountMinor : null,
          };
        }),
    );
  }
  if (inScope('in_house_balance') && !unavailable.includes('in_house_balance')) {
    const ex = excludedKeys('in_house_balance');
    const bal = new Map(input.portico.inHouse.map((b) => [`${b.bookingId}#${b.folioRef}`, b]));
    moneyClass(
      'in_house_balance',
      records
        .filter((r) => r.dataClass === 'in_house_balance' && r.payload)
        .map((r) => {
          const p = r.payload as {
            bookingKey: string;
            folioRef: string;
            balanceMinor: number;
            currency: string;
          };
          const bid = resvTarget(p.bookingKey);
          const b = bid ? bal.get(`${bid}#${p.folioRef}`) : undefined;
          return {
            key: r.key,
            amount: p.balanceMinor,
            currency: p.currency,
            excluded: ex.has(r.key),
            portico: b && b.currency === p.currency ? b.balanceMinor : null,
          };
        }),
    );
  }
  if (inScope('ar_open_item') && !unavailable.includes('ar_open_item')) {
    const ex = excludedKeys('ar_open_item');
    const ar = new Map(input.portico.receivables.map((a) => [`${a.accountCode}#${a.invoiceRef}`, a]));
    const items = records
      .filter((r) => r.dataClass === 'ar_open_item' && r.payload)
      .map((r) => {
        const p = r.payload as {
          accountCode: string;
          invoiceRef: string;
          openMinor: number;
          currency: string;
          dueDate: LocalDate | null;
          invoiceDate: LocalDate;
        };
        const a = ar.get(`${p.accountCode}#${p.invoiceRef}`);
        return {
          key: r.key,
          amount: p.openMinor,
          currency: p.currency,
          excluded: ex.has(r.key),
          portico: a && a.currency === p.currency ? a.openMinor : null,
          bucket: agingBucket(p.dueDate ?? p.invoiceDate, input.businessDate),
          account: p.accountCode,
        };
      });
    moneyClass('ar_open_item', items);
    const buckets = new Map<string, { s: number; q: number }>();
    for (const i of items.filter((x) => !x.excluded)) {
      const k = `${i.account}|${i.bucket}|${i.currency}`;
      const b = buckets.get(k) ?? { s: 0, q: 0 };
      b.s += i.amount;
      b.q += i.portico ?? 0;
      buckets.set(k, b);
    }
    for (const [k, b] of buckets) {
      const [account, bucket, cur] = k.split('|') as [string, string, string];
      measure('ar_open_item', `aging ${account} ${bucket}`, cur, b.s, b.q);
    }
  }

  const unexplained = differences.filter((d) => !d.explained);
  const body = {
    accounting,
    measures: [...measures].sort((a, b) =>
      `${a.dataClass}|${a.measure}|${a.currency}`.localeCompare(`${b.dataClass}|${b.measure}|${b.currency}`),
    ),
    controlTotals,
    differences: differences
      .map(({ dataClass, key, measure: m, source, portico, explained }) => ({
        dataClass,
        key,
        measure: m,
        source,
        portico,
        explained,
      }))
      .sort((a, b) =>
        `${a.dataClass}|${a.key}|${a.measure}`.localeCompare(`${b.dataClass}|${b.key}|${b.measure}`),
      ),
    unavailable,
  };
  return {
    exact: unexplained.length === 0 && measures.every((m) => m.equal),
    accounting,
    measures: body.measures,
    controlTotals,
    differences,
    unavailable,
    fingerprint: sha256Hex(canonicalJson(body)).slice(0, 32),
  };
}
