/**
 * Build a reconciliation report: source state + control totals vs what the owning modules ACTUALLY hold (read back
 * through ports), store it (append-only, versioned) and turn every unexplained difference into an exception with an
 * owner. Differences are never "corrected" here.
 */
import type { TxContext } from '@portico/db';
import { addDays, DomainError, newId, requirePermission } from '@portico/kernel';
import { type PorticoReadBack, type ReconciliationResult, reconcile } from '../domain/reconcile';
import { type DataClass, FINANCIAL_CLASSES } from '../domain/records';
import { ProviderUnavailableError } from '../ports';
import { actorKey, db, type Job, type MigrationDeps } from './context';
import { currentControlTotals, impliedUnitTypes, unitTypeIds } from './importer';
import { closeCorrected, ledgerNamespace, loadLedger, loadSourceRecords, raiseException } from './state';

export type ReportContext = 'rehearsal' | 'certification' | 'verify' | 'sweep';

function unavailableErr(err: unknown): boolean {
  return (
    err instanceof ProviderUnavailableError ||
    (err instanceof DomainError && (err.code === 'module_not_available' || err.code === 'module_unavailable'))
  );
}

/** The classes a job reconciles: its scope, plus unit types whenever reservations are migrated. */
export function effectiveScope(job: Job): Set<DataClass> {
  const s = new Set<DataClass>(job.plan.scope);
  if (s.has('reservation')) s.add('unit_type');
  return s;
}

export async function buildReport(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  context: ReportContext,
): Promise<{ id: string; seq: number; result: ReconciliationResult }> {
  const { ports } = deps;
  const records0 = await loadSourceRecords(tx, job.id);
  const records = [...records0, ...impliedUnitTypes(records0)];
  const ledgerMap = await loadLedger(tx, job);
  const ledger = [...ledgerMap.values()];
  const property = await ports.platform.getProperty(tx, job.propertyId);
  const scope = effectiveScope(job);
  const unavailable: DataClass[] = [];
  const read = async <T>(classes: DataClass[], fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (!classes.some((c) => scope.has(c))) return fallback;
    try {
      return await fn();
    } catch (err) {
      if (!unavailableErr(err)) throw err;
      for (const c of classes) if (scope.has(c) && !unavailable.includes(c)) unavailable.push(c);
      return fallback;
    }
  };
  const targets = (c: DataClass) =>
    ledger.filter((l) => l.dataClass === c && (l.state === 'imported' || l.state === 'merged') && l.targetId);
  const bookingIds = [...new Set(targets('reservation').map((l) => l.targetId as string))];
  const portico: PorticoReadBack = {
    unitTypes: await read(['unit_type'], () => ports.inventory.listUnitTypes(tx, job.propertyId), []),
    units: await read(['unit'], () => ports.inventory.listUnits(tx, job.propertyId), []),
    existingGuestIds: new Set(
      await read(
        ['guest'],
        () =>
          ports.guests.existing(tx, {
            propertyId: job.propertyId,
            profileIds: targets('guest').map((l) => l.targetId as string),
          }),
        [],
      ),
    ),
    reservations: await read(
      ['reservation'],
      () =>
        ports.reservations.listImported(tx, {
          propertyId: job.propertyId,
          sourceSystem: ledgerNamespace(job),
        }),
      [],
    ),
    sold: await read(
      ['reservation'],
      () =>
        ports.inventory.sold(tx, {
          propertyId: job.propertyId,
          from: property.businessDate,
          to: addDays(property.businessDate, 366),
        }),
      [],
    ),
    deposits: await read(
      ['deposit'],
      () => ports.finance.depositBalances(tx, { propertyId: job.propertyId, bookingIds }),
      [],
    ),
    inHouse: await read(
      ['in_house_balance'],
      () => ports.finance.folioOpeningBalances(tx, { propertyId: job.propertyId, bookingIds }),
      [],
    ),
    receivables: await read(
      ['ar_open_item'],
      () => ports.finance.receivableOpenItems(tx, { propertyId: job.propertyId }),
      [],
    ),
    unavailable,
  };
  const result = reconcile({
    records,
    ledger,
    controlTotals: await currentControlTotals(tx, job),
    portico,
    businessDate: property.businessDate,
    scope,
    unitTypeIdByCode: await unitTypeIds(tx, job),
  });
  const last = await db(tx)
    .selectFrom('migration.reports')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  const lastExtract = await db(tx)
    .selectFrom('migration.extracts')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  const seq = Number(last?.seq ?? 0) + 1;
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('migration.reports')
    .values({
      id,
      tenant_id: tx.tenantId,
      job_id: job.id,
      seq,
      context,
      extract_seq: Number(lastExtract?.seq ?? 0),
      exact: result.exact,
      fingerprint: result.fingerprint,
      result: JSON.stringify(result),
      generated_by: actorKey(tx),
      generated_at: tx.now,
    })
    .execute();
  // Every unexplained difference is an exception with an owner; differences that disappeared are closed.
  const present = new Set<string>();
  for (const d of result.differences.filter((x) => !x.explained)) {
    const code = `reconcile_${d.measure.split(' ')[0]}`.slice(0, 60);
    const key = d.key ?? (d.measure.includes(' ') ? d.measure.split(' ').slice(1).join(' ') : null);
    present.add(`${d.dataClass}:${key ?? ''}:${code}`);
    await raiseException(tx, job, {
      dataClass: d.dataClass,
      key,
      code,
      severity: 'blocking',
      problem: d.message,
      impact: 'Not reconciled: nothing is called migrated until this difference is explained.',
      proposedResolution: FINANCIAL_CLASSES.has(d.dataClass)
        ? 'Finance compares the source report with Portico and records the explanation or correction.'
        : 'Check the record in both systems; correct the source or the mapping and run the migration again.',
    });
  }
  await closeCorrected(tx, job, present, { prefix: 'reconcile_' });
  await tx.audit({
    action: 'migration.reconciliation.run',
    target: { type: 'migration_report', id },
    propertyId: job.propertyId,
    after: { jobId: job.id, seq, context, exact: result.exact, fingerprint: result.fingerprint },
  });
  await tx.emit({
    type: 'migration.reconciliation.completed',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: {
      jobId: job.id,
      reportId: id,
      seq,
      context,
      exact: result.exact,
      fingerprint: result.fingerprint,
    },
  });
  return { id, seq, result };
}

export async function latestReports(tx: TxContext, jobId: string, n = 2) {
  const job = await db(tx)
    .selectFrom('migration.jobs')
    .select('property_id')
    .where('id', '=', jobId)
    .executeTakeFirst();
  requirePermission(tx, 'migration.job.read', { propertyId: job?.property_id ?? null });
  return db(tx)
    .selectFrom('migration.reports')
    .select(['id', 'seq', 'context', 'exact', 'fingerprint', 'extract_seq', 'generated_at'])
    .where('job_id', '=', jobId)
    .orderBy('seq', 'desc')
    .limit(n)
    .execute();
}
