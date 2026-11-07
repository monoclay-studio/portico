/**
 * Import: source records → owning modules, in dependency order, in small transactions (a crash loses at most one
 * chunk and `run` resumes). Each record is claimed under a row lock in the import ledger, so a retry, a second
 * runner or a delta sync can never create a second copy (zero duplicate reservations is a hard invariant). A record
 * whose content has not changed since it was imported is skipped; a changed one is updated through the provider —
 * except opening balances, which are posted once and never re-posted (corrections go through finance).
 */
import { type PorticoDatabase, type TxContext, withSavepoint, withTenantTx } from '@portico/db';
import {
  canonicalJson,
  DomainError,
  ModuleUnavailableError,
  newId,
  type RequestContext,
  sha256Hex,
} from '@portico/kernel';
import {
  type ArOpenItemRecord,
  CONSUMING_STATUSES,
  type ControlTotal,
  contentHash,
  type DataClass,
  type DepositRecord,
  type GuestRecord,
  type InHouseBalanceRecord,
  type ReservationRecord,
  type SourceRecord,
  type UnitRecord,
  type UnitTypeRecord,
} from '../domain/records';
import { ProviderUnavailableError } from '../ports';
import { db, type Job, loadJob, loadJobFor, type MigrationDeps } from './context';
import { loadExtracts, materialize } from './extract';
import {
  exceptionDecisions,
  importability,
  ledgerNamespace,
  loadSourceRecords,
  raiseException,
  setLedger,
} from './state';

export const CHUNK = 100;

const IMPORT_ORDER: DataClass[] = [
  'unit_type',
  'unit',
  'rate_plan',
  'guest',
  'reservation',
  'deposit',
  'in_house_balance',
  'ar_open_item',
];

export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  merged: number;
  exceptions: number;
  excluded: number;
  pending: number;
  /** Classes that could not be imported because their provider is not available on this server. */
  unavailable: DataClass[];
}

const emptySummary = (): ImportSummary => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  merged: 0,
  exceptions: 0,
  excluded: 0,
  pending: 0,
  unavailable: [],
});

function isUnavailable(err: unknown): boolean {
  return err instanceof ProviderUnavailableError || err instanceof ModuleUnavailableError;
}

interface LockedLedger {
  state: string;
  targetId: string | null;
  importedHash: string | null;
}

/** Claim the ledger row of a record under a row lock (inserting a `pending` row first if there is none). */
async function claim(tx: TxContext, job: Job, dataClass: DataClass, key: string): Promise<LockedLedger> {
  await db(tx)
    .insertInto('migration.import_ledger')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      property_id: job.propertyId,
      source_system: ledgerNamespace(job),
      data_class: dataClass,
      source_key: key,
      state: 'pending',
      target_type: null,
      target_id: null,
      imported_hash: null,
      first_job_id: job.id,
      last_job_id: job.id,
      reason: null,
      imported_at: null,
      updated_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'property_id', 'source_system', 'data_class', 'source_key']).doNothing(),
    )
    .execute();
  const row = await db(tx)
    .selectFrom('migration.import_ledger')
    .select(['state', 'target_id', 'imported_hash'])
    .where('property_id', '=', job.propertyId)
    .where('source_system', '=', ledgerNamespace(job))
    .where('data_class', '=', dataClass)
    .where('source_key', '=', key)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return { state: row.state, targetId: row.target_id, importedHash: row.imported_hash };
}

async function ledgerTargets(tx: TxContext, job: Job, dataClass: DataClass): Promise<Map<string, string>> {
  const rows = await db(tx)
    .selectFrom('migration.import_ledger')
    .select(['source_key', 'target_id'])
    .where('property_id', '=', job.propertyId)
    .where('source_system', '=', ledgerNamespace(job))
    .where('data_class', '=', dataClass)
    .where('state', 'in', ['imported', 'merged', 'suggested'])
    .execute();
  return new Map(rows.filter((r) => r.target_id).map((r) => [r.source_key, r.target_id as string]));
}

/** Resolve unit-type ids for source codes: imported (created) types and reviewed `map` decisions. */
export async function unitTypeIds(tx: TxContext, job: Job): Promise<Map<string, string>> {
  const out = await ledgerTargets(tx, job, 'unit_type');
  for (const d of job.plan.unitTypes) if (d.action === 'map' && d.targetId) out.set(d.sourceCode, d.targetId);
  return out;
}

/** Unit types implied by reservations / units when the source has no unit-type list (named by their code). */
export function impliedUnitTypes(records: readonly SourceRecord[]): Array<SourceRecord<'unit_type'>> {
  const declared = new Set(records.filter((r) => r.dataClass === 'unit_type').map((r) => r.key));
  const implied = new Map<string, number>();
  for (const r of records) {
    if (r.payload === null) continue;
    if (r.dataClass === 'reservation') {
      const p = r.payload as ReservationRecord;
      implied.set(p.unitTypeCode, Math.max(implied.get(p.unitTypeCode) ?? 2, p.adults + p.children));
    }
    if (r.dataClass === 'unit') {
      const p = r.payload as UnitRecord;
      implied.set(p.unitTypeCode, implied.get(p.unitTypeCode) ?? 2);
    }
  }
  return [...implied]
    .filter(([code]) => !declared.has(code))
    .map(([code, maxOcc]) => ({
      dataClass: 'unit_type' as const,
      key: code,
      payload: { code, name: code, maxOccupancy: maxOcc, baseOccupancy: null },
      origin: { file: 'derived from reservations', row: null },
      problems: [
        {
          code: 'unit_type_derived',
          severity: 'warning' as const,
          message: `The source has no unit-type list; ${code} is created from the codes used on reservations (maximum occupancy ${maxOcc} as seen on bookings). Review it in Inventory.`,
        },
      ],
    }));
}

/**
 * Import the current source state into the target organization. `onlyNew` (post-cutover sweep) imports records
 * never imported before and raises an exception for records changed after the final capture instead of applying
 * them (a change in both systems is never silently overwritten).
 */
export async function importAll(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  jobId: string,
  opts: { onlyNew?: boolean; failAfter?: number } = {},
): Promise<ImportSummary> {
  const summary = emptySummary();
  const { records, job } = await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJobFor(tx, jobId, 'migration.job.manage');
    const recs = await loadSourceRecords(tx, jobId);
    return { job: j, records: [...recs, ...impliedUnitTypes(recs)] };
  });
  const blockedClasses = new Set<DataClass>();
  let processed = 0;
  for (const dataClass of IMPORT_ORDER) {
    if (
      !job.plan.scope.includes(dataClass) &&
      !(dataClass === 'unit_type' && job.plan.scope.includes('reservation'))
    )
      continue;
    const list = records
      .filter((r) => r.dataClass === dataClass)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (dataClass === 'deposit' || dataClass === 'in_house_balance' || dataClass === 'ar_open_item') {
      await withTenantTx(database, ctx, async (tx) => {
        const j = await loadJob(tx, jobId, { lock: true });
        await importMoney(tx, deps, j, dataClass, list, summary, blockedClasses, opts);
      });
      continue;
    }
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      await withTenantTx(database, ctx, async (tx) => {
        // The job row lock serializes every importer of this job (concurrent `run`, delta sync, sweep).
        const j = await loadJob(tx, jobId, { lock: true });
        const decisions = await exceptionDecisions(tx, jobId);
        const ctxIds = await importContext(tx, deps, j, records);
        for (const r of chunk) {
          if (opts.failAfter !== undefined && processed >= opts.failAfter)
            throw new Error(`Injected failure after ${processed} records (test)`);
          processed++;
          await importOne(
            tx,
            deps,
            j,
            r,
            decisions.get(`${r.dataClass}:${r.key}`),
            ctxIds,
            summary,
            blockedClasses,
            opts,
          );
        }
      });
    }
  }
  summary.unavailable = [...blockedClasses];
  return summary;
}

interface ImportIds {
  unitTypes: Map<string, string>;
  units: Map<string, string>;
  guests: Map<string, string>;
  businessDate: string;
  /** Units count in inventory from the earliest night an imported in-house stay occupies. */
  inventoryFrom: string;
}

async function importContext(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  records: readonly SourceRecord[],
): Promise<ImportIds> {
  const businessDate = (await deps.ports.platform.getProperty(tx, job.propertyId)).businessDate;
  let inventoryFrom = businessDate;
  for (const r of records)
    if (r.dataClass === 'reservation' && r.payload) {
      const p = r.payload as ReservationRecord;
      if (p.status === 'in_house' && p.arrival < inventoryFrom) inventoryFrom = p.arrival;
    }
  return {
    unitTypes: await unitTypeIds(tx, job),
    units: await ledgerTargets(tx, job, 'unit'),
    guests: await ledgerTargets(tx, job, 'guest'),
    businessDate,
    inventoryFrom,
  };
}

async function importOne(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  r: SourceRecord,
  decisions: Parameters<typeof importability>[1],
  ids: ImportIds,
  summary: ImportSummary,
  blockedClasses: Set<DataClass>,
  opts: { onlyNew?: boolean },
): Promise<void> {
  const verdict = importability(r, decisions);
  const hash = contentHash(r.payload ?? r.raw ?? null);
  const ledger = await claim(tx, job, r.dataClass, r.key);
  const imported = ledger.state === 'imported' || ledger.state === 'merged' || ledger.state === 'suggested';
  if (verdict.verdict !== 'import') {
    if (!imported) {
      await setLedger(tx, job, {
        dataClass: r.dataClass,
        key: r.key,
        state: verdict.verdict,
        reason: verdict.reason,
      });
      if (verdict.verdict === 'excluded') summary.excluded++;
      else summary.exceptions++;
    }
    return;
  }
  if (imported && ledger.importedHash === hash) {
    summary.unchanged++;
    return;
  }
  if (imported && opts.onlyNew) {
    await raiseException(tx, job, {
      dataClass: r.dataClass,
      key: r.key,
      code: 'changed_after_final_capture',
      severity: 'blocking',
      problem: `${r.key} changed in the previous system after the final capture. Portico is now the system of record, so the change is not applied automatically.`,
      proposedResolution: 'Compare both versions and make the change in Portico if it is still needed.',
    });
    summary.exceptions++;
    return;
  }
  const dependsOn: Partial<Record<DataClass, DataClass>> = { unit: 'unit_type', reservation: 'unit_type' };
  const dep = dependsOn[r.dataClass];
  if (dep && blockedClasses.has(dep)) {
    await setLedger(tx, job, {
      dataClass: r.dataClass,
      key: r.key,
      state: 'pending',
      reason: `Waiting for ${dep}`,
    });
    summary.pending++;
    return;
  }
  try {
    await withSavepoint(tx, 'mig_record', async () => {
      const result = await applyRecord(tx, deps, job, r, ledger.targetId, ids);
      await setLedger(tx, job, {
        dataClass: r.dataClass,
        key: r.key,
        state: result.state,
        targetType: result.targetType,
        targetId: result.targetId,
        importedHash: hash,
        reason: result.reason ?? null,
      });
      if (result.state === 'merged') summary.merged++;
      else if (imported) summary.updated++;
      else summary.created++;
    });
  } catch (err) {
    if (isUnavailable(err)) {
      blockedClasses.add(r.dataClass);
      await setLedger(tx, job, {
        dataClass: r.dataClass,
        key: r.key,
        state: 'pending',
        reason: err instanceof Error ? err.message : 'provider unavailable',
      });
      await raiseException(tx, job, {
        dataClass: r.dataClass,
        key: null,
        code: 'provider_unavailable',
        severity: 'blocking',
        problem: err instanceof Error ? err.message : 'A provider is not available.',
        ownerRole: 'Monoclay onboarding lead',
        impact: 'These records wait; nothing is shown as migrated until they are imported and reconciled.',
        proposedResolution: 'Run the migration again when the provider is available on this server.',
        financial: false,
      });
      summary.pending++;
      return;
    }
    if (!(err instanceof DomainError)) throw err;
    await setLedger(tx, job, { dataClass: r.dataClass, key: r.key, state: 'rejected', reason: err.message });
    await raiseException(tx, job, {
      dataClass: r.dataClass,
      key: r.key,
      code: `rejected_${err.code}`.slice(0, 80),
      severity: 'blocking',
      problem: `Portico refused this record: ${err.message}`,
    });
    summary.exceptions++;
  }
}

interface Applied {
  state: 'imported' | 'merged' | 'suggested';
  targetType: string;
  targetId: string | null;
  reason?: string;
}

async function applyRecord(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  r: SourceRecord,
  existingTarget: string | null,
  ids: ImportIds,
): Promise<Applied> {
  const { ports } = deps;
  switch (r.dataClass) {
    case 'unit_type': {
      const p = r.payload as UnitTypeRecord;
      const decision = job.plan.unitTypes.find((d) => d.sourceCode === p.code);
      if (decision?.action === 'map' && decision.targetId) {
        ids.unitTypes.set(p.code, decision.targetId);
        return {
          state: 'merged',
          targetType: 'unitType',
          targetId: decision.targetId,
          reason: 'Mapped to an existing unit type',
        };
      }
      if (existingTarget) return { state: 'imported', targetType: 'unitType', targetId: existingTarget };
      const max = Math.max(1, p.maxOccupancy ?? 2);
      const created = await ports.inventory.createUnitType(tx, job.propertyId, {
        code: decision?.targetCode ?? p.code,
        name: p.name,
        maxOccupancy: max,
        baseOccupancy: Math.min(max, p.baseOccupancy ?? Math.min(2, max)),
      });
      ids.unitTypes.set(p.code, created.id);
      return { state: 'imported', targetType: 'unitType', targetId: created.id };
    }
    case 'unit': {
      const p = r.payload as UnitRecord;
      const typeId = ids.unitTypes.get(p.unitTypeCode);
      if (!typeId)
        throw new DomainError(
          'unit_type_not_imported',
          `Unit type ${p.unitTypeCode} of unit ${p.number} is not in Portico.`,
        );
      if (existingTarget) return { state: 'imported', targetType: 'unit', targetId: existingTarget };
      const existing = (await ports.inventory.listUnits(tx, job.propertyId)).find(
        (u) => u.number.toUpperCase() === p.number.toUpperCase(),
      );
      if (existing) {
        ids.units.set(r.key, existing.id);
        return {
          state: 'merged',
          targetType: 'unit',
          targetId: existing.id,
          reason: 'Unit already in Portico',
        };
      }
      const created = await ports.inventory.createUnit(tx, job.propertyId, {
        unitTypeId: typeId,
        number: p.number,
        ...(p.name ? { name: p.name } : {}),
        inInventoryFrom: ids.inventoryFrom,
      });
      ids.units.set(r.key, created.id);
      return { state: 'imported', targetType: 'unit', targetId: created.id };
    }
    case 'rate_plan': {
      const d = job.plan.ratePlans.find((x) => x.sourceCode === r.key);
      return {
        state: 'suggested',
        targetType: 'ratePlan',
        targetId: d?.targetId ?? null,
        reason:
          d?.action === 'map'
            ? `Matched to rate plan ${d.targetCode}`
            : 'Not created: rate plans and prices are set up in Rates; migrated bookings keep their agreed prices',
      };
    }
    case 'guest': {
      if (existingTarget) return { state: 'imported', targetType: 'guestProfile', targetId: existingTarget };
      const p = r.payload as GuestRecord;
      const res = await ports.guests.importProfile(tx, {
        propertyId: job.propertyId,
        sourceSystem: ledgerNamespace(job),
        sourceKey: r.key,
        givenName: p.givenName,
        familyName: p.familyName,
        email: p.email,
        phone: p.phone,
        nationality: p.nationality,
        dateOfBirth: p.dateOfBirth,
        language: p.language,
      });
      ids.guests.set(r.key, res.profileId);
      const dupes = res.possibleDuplicates.filter((d) => d.profileId !== res.profileId);
      if (dupes.length)
        await raiseException(tx, job, {
          dataClass: 'guest',
          key: r.key,
          code: 'possible_duplicate_in_portico',
          severity: 'warning',
          problem: `Possible duplicate of existing profile(s) ${dupes.map((d) => `${d.profileId} (${d.band})`).join(', ')}: ${dupes[0]?.reasons.join('; ') ?? ''}. Never merged automatically.`,
          ownerRole: 'Front office manager',
          proposedResolution: 'Review the pair in Guests → Duplicates; a merge is reversible.',
        });
      return res.created
        ? { state: 'imported', targetType: 'guestProfile', targetId: res.profileId }
        : {
            state: 'merged',
            targetType: 'guestProfile',
            targetId: res.profileId,
            reason: 'Linked to an existing profile (exact match)',
          };
    }
    case 'reservation': {
      const p = r.payload as ReservationRecord;
      const unitTypeId = ids.unitTypes.get(p.unitTypeCode);
      if (!unitTypeId)
        throw new DomainError('unit_type_not_imported', `Unit type ${p.unitTypeCode} is not in Portico.`);
      const res = await ports.reservations.importBooking(tx, {
        propertyId: job.propertyId,
        sourceSystem: ledgerNamespace(job),
        sourceKey: r.key,
        sourceVersion: contentHash(p),
        status: p.status,
        arrival: p.arrival,
        departure: p.departure,
        unitTypeId,
        unitId: p.unitNumber ? (ids.units.get(p.unitNumber.toUpperCase()) ?? null) : null,
        adults: p.adults,
        children: p.children,
        guestProfileId: p.guestKey ? (ids.guests.get(p.guestKey) ?? null) : null,
        guestName: p.guestName,
        channel: p.channel,
        terms: {
          currency: p.currency,
          ratePlanCode: p.ratePlanCode,
          nightly: p.nightly,
          roomTotalMinor: p.roomTotalMinor,
          taxes: p.taxes,
          taxInclusive: p.taxInclusive,
          totalMinor: p.totalMinor,
          guarantee: p.guarantee,
        },
      });
      if (res.inventoryConflictIds.length)
        await raiseException(tx, job, {
          dataClass: 'reservation',
          key: r.key,
          code: 'inventory_conflict',
          severity: 'warning',
          problem: `Imported, but the nights were already full: inventory conflict(s) ${res.inventoryConflictIds.join(', ')} recorded for the reservations manager.`,
          proposedResolution: 'Resolve the conflict in Inventory (relocate, authorize overbooking or move).',
        });
      if (
        p.guarantee === 'card_at_previous_psp' &&
        CONSUMING_STATUSES.has(p.status) &&
        p.status !== 'in_house' &&
        p.arrival >= ids.businessDate
      )
        await db(tx)
          .insertInto('migration.card_recollections')
          .values({
            id: newId(tx.now.getTime()),
            tenant_id: tx.tenantId,
            job_id: job.id,
            property_id: job.propertyId,
            source_key: r.key,
            booking_id: res.bookingId,
            guest_profile_id: p.guestKey ? (ids.guests.get(p.guestKey) ?? null) : null,
            arrival: p.arrival,
            status: 'to_request',
            reference: null,
            note: 'Guarantee card held by the previous payment provider: ask the guest for a card again (Q142).',
            updated_at: tx.now,
          })
          .onConflict((oc) => oc.columns(['job_id', 'source_key']).doNothing())
          .execute();
      return { state: 'imported', targetType: 'booking', targetId: res.bookingId };
    }
    default:
      throw new Error(`applyRecord does not handle ${r.dataClass}`);
  }
}

/**
 * Opening balances (deposits, in-house folios, receivables) go to finance in one call per currency, through migration
 * suspense with the source's references. Posted once: a balance that changes after it was posted is an exception for
 * finance (corrections are new entries in finance, never a second import).
 */
async function importMoney(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  dataClass: 'deposit' | 'in_house_balance' | 'ar_open_item',
  list: SourceRecord[],
  summary: ImportSummary,
  blockedClasses: Set<DataClass>,
  opts: { onlyNew?: boolean },
): Promise<void> {
  const decisions = await exceptionDecisions(tx, job.id);
  const bookings = await ledgerTargets(tx, job, 'reservation');
  const ready: Array<{ r: SourceRecord; hash: string; bookingId: string | null }> = [];
  for (const r of list) {
    const verdict = importability(r, decisions.get(`${r.dataClass}:${r.key}`));
    const hash = contentHash(r.payload ?? r.raw ?? null);
    const ledger = await claim(tx, job, r.dataClass, r.key);
    const imported = ledger.state === 'imported' || ledger.state === 'merged';
    if (imported) {
      if (ledger.importedHash === hash) summary.unchanged++;
      else {
        await raiseException(tx, job, {
          dataClass,
          key: r.key,
          code: 'opening_balance_changed',
          severity: 'blocking',
          problem: `This ${dataClass.replace(/_/g, ' ')} changed in the source after it was posted as an opening balance. It is never posted twice.`,
          proposedResolution:
            'Finance records the difference through its correction flow, then closes this exception.',
        });
        summary.exceptions++;
      }
      continue;
    }
    if (verdict.verdict !== 'import') {
      await setLedger(tx, job, { dataClass, key: r.key, state: verdict.verdict, reason: verdict.reason });
      if (verdict.verdict === 'excluded') summary.excluded++;
      else summary.exceptions++;
      continue;
    }
    const bookingKey =
      dataClass === 'ar_open_item' ? null : (r.payload as DepositRecord | InHouseBalanceRecord).bookingKey;
    const bookingId = bookingKey ? (bookings.get(bookingKey) ?? null) : null;
    if (bookingKey && !bookingId) {
      await setLedger(tx, job, {
        dataClass,
        key: r.key,
        state: 'pending',
        reason: `Waiting for reservation ${bookingKey} to be imported`,
      });
      summary.pending++;
      continue;
    }
    ready.push({ r, hash, bookingId });
  }
  if (ready.length === 0) return;
  const currencies = new Set(ready.map((x) => (x.r.payload as { currency: string }).currency));
  for (const currency of currencies) {
    const batch = ready.filter((x) => (x.r.payload as { currency: string }).currency === currency);
    const importRef = `mig:${job.id.slice(0, 8)}:${dataClass}:${currency}:${sha256Hex(canonicalJson(batch.map((b) => [b.r.key, b.hash]))).slice(0, 16)}`;
    try {
      await withSavepoint(tx, 'mig_money', async () => {
        if (dataClass === 'deposit') {
          const all = list.filter((x) => x.payload && (x.payload as DepositRecord).currency === currency);
          const total = batch.reduce((s, b) => s + (b.r.payload as DepositRecord).amountMinor, 0);
          const control = await controlTotal(tx, job, 'deposit', currency);
          // The source's reported closing balance only when this batch is the whole ledger (first posting).
          const provided = control !== null && batch.length === all.length ? control : total;
          const out = await deps.ports.finance.importOpeningDeposits(tx, {
            propertyId: job.propertyId,
            importRef,
            currency,
            providedClosingMinor: provided,
            items: batch.map((b) => {
              const d = b.r.payload as DepositRecord;
              return {
                bookingId: b.bookingId as string,
                externalRef: `${ledgerNamespace(job)}:${b.r.key}`,
                amountMinor: d.amountMinor,
                declaredTaxes: d.taxDeclared.map((t) => {
                  const account = job.plan.taxAccounts.find((a) => a.sourceCode === t.code)?.accountKey;
                  if (!account)
                    throw new DomainError(
                      'tax_mapping_missing',
                      `Declared tax ${t.code} has no reviewed finance tax account. Finance maps it in the mapping step.`,
                    );
                  return { accountKey: account, name: t.name, amountMinor: t.amountMinor };
                }),
              };
            }),
          });
          const rejected = new Map(out.rejected.map((x) => [x.bookingId, x.reason]));
          for (const b of batch) {
            const reason = rejected.get(b.bookingId as string);
            await setLedger(tx, job, {
              dataClass,
              key: b.r.key,
              state: reason ? 'rejected' : 'imported',
              targetType: 'deposit',
              targetId: b.bookingId,
              importedHash: reason ? null : b.hash,
              reason: reason ?? null,
            });
            if (reason) {
              await raiseException(tx, job, {
                dataClass,
                key: b.r.key,
                code: 'finance_rejected',
                severity: 'blocking',
                problem: `Finance refused this opening deposit: ${reason}`,
              });
              summary.exceptions++;
            } else summary.created++;
          }
          if (out.status === 'difference')
            await raiseException(tx, job, {
              dataClass,
              key: null,
              code: `closing_balance_difference_${currency}`,
              severity: 'blocking',
              problem: `Finance reports that the imported deposits (${out.importedTotalMinor}) differ from the source's closing balance (${provided}) by ${out.differenceMinor} ${currency} minor units. It is never plugged.`,
              proposedResolution:
                'Finance explains the difference (missing deposit, refund not exported…) and records the correction.',
            });
          return;
        }
        if (dataClass === 'in_house_balance') {
          const out = await deps.ports.finance.importOpeningFolioBalances(tx, {
            propertyId: job.propertyId,
            importRef,
            items: batch.map((b) => {
              const p = b.r.payload as InHouseBalanceRecord;
              return {
                bookingId: b.bookingId as string,
                folioRef: p.folioRef,
                balanceMinor: p.balanceMinor,
                currency: p.currency,
                externalRef: `${ledgerNamespace(job)}:${b.r.key}`,
              };
            }),
          });
          const rejected = new Map(out.rejected.map((x) => [x.bookingId, x.reason]));
          for (const b of batch) {
            const reason = rejected.get(b.bookingId as string);
            await setLedger(tx, job, {
              dataClass,
              key: b.r.key,
              state: reason ? 'rejected' : 'imported',
              targetType: 'folio_opening_balance',
              targetId: b.bookingId,
              importedHash: reason ? null : b.hash,
              reason: reason ?? null,
            });
            if (reason) summary.exceptions++;
            else summary.created++;
          }
          return;
        }
        const out = await deps.ports.finance.importOpeningReceivables(tx, {
          propertyId: job.propertyId,
          importRef,
          items: batch.map((b) => {
            const p = b.r.payload as ArOpenItemRecord;
            return {
              accountCode: p.accountCode,
              accountName: p.accountName,
              invoiceRef: p.invoiceRef,
              invoiceDate: p.invoiceDate,
              dueDate: p.dueDate,
              openMinor: p.openMinor,
              currency: p.currency,
            };
          }),
        });
        const rejected = new Map(out.rejected.map((x) => [x.invoiceRef, x.reason]));
        for (const b of batch) {
          const p = b.r.payload as ArOpenItemRecord;
          const reason = rejected.get(p.invoiceRef);
          await setLedger(tx, job, {
            dataClass,
            key: b.r.key,
            state: reason ? 'rejected' : 'imported',
            targetType: 'receivable_open_item',
            targetId: null,
            importedHash: reason ? null : b.hash,
            reason: reason ?? null,
          });
          if (reason) summary.exceptions++;
          else summary.created++;
        }
      });
    } catch (err) {
      if (isUnavailable(err)) {
        blockedClasses.add(dataClass);
        for (const b of batch)
          await setLedger(tx, job, {
            dataClass,
            key: b.r.key,
            state: 'pending',
            reason: err instanceof Error ? err.message : 'provider unavailable',
          });
        await raiseException(tx, job, {
          dataClass,
          key: null,
          code: 'provider_unavailable',
          severity: 'blocking',
          problem: err instanceof Error ? err.message : 'A provider is not available.',
          ownerRole: 'Monoclay onboarding lead',
          impact: 'These balances wait; nothing is shown as migrated until they are posted and reconciled.',
          proposedResolution: 'Run the migration again when the provider is available on this server.',
          financial: true,
        });
        summary.pending += batch.length;
        continue;
      }
      if (!(err instanceof DomainError)) throw err;
      for (const b of batch)
        await setLedger(tx, job, { dataClass, key: b.r.key, state: 'rejected', reason: err.message });
      await raiseException(tx, job, {
        dataClass,
        key: null,
        code: `rejected_${err.code}`.slice(0, 80),
        severity: 'blocking',
        problem: `Finance refused the opening ${dataClass.replace(/_/g, ' ')} batch (${currency}): ${err.message}`,
      });
      summary.exceptions += batch.length;
    }
  }
  void opts;
}

/** Control totals the source reported (closing balances, counts); a later extract overrides an earlier one. */
export async function currentControlTotals(tx: TxContext, job: Job): Promise<ControlTotal[]> {
  const byKey = new Map<string, ControlTotal>();
  for (const e of await loadExtracts(tx, job.id))
    for (const t of materialize(e, job.plan).controlTotals) byKey.set(`${t.dataClass}|${t.currency}`, t);
  return [...byKey.values()];
}

async function controlTotal(
  tx: TxContext,
  job: Job,
  dataClass: DataClass,
  currency: string,
): Promise<number | null> {
  const t = (await currentControlTotals(tx, job)).find(
    (c) => c.dataClass === dataClass && c.currency === currency,
  );
  return t?.amountMinor ?? null;
}
