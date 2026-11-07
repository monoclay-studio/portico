/**
 * Day reports (DCL-R07): the immutable "as closed" pack plus a "restatements since" annex computed on read from
 * finance (corrections relating to the date, revenue now vs. revenue frozen at close). Frozen day facts (DCL-I03).
 * Portfolio Day Close board (DCL-R08).
 */
import type { TxContext } from '@portico/db';
import { diffDays, instantToZoned, NotFoundError, requirePermission } from '@portico/kernel';
import type { DayFacts, DayReport, RunStatus, StepKey } from '../contracts';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { type Deps, db } from './context';

export async function getFacts(
  _deps: Deps,
  tx: TxContext,
  propertyId: string,
  date: string,
): Promise<DayFacts> {
  requirePermission(tx, P.reportRead, { propertyId });
  const row = await db(tx)
    .selectFrom('day_close.day_facts')
    .select(['facts'])
    .where('property_id', '=', propertyId)
    .where('business_date', '=', date)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('day_facts', `${propertyId}:${date}`);
  return row.facts as DayFacts;
}

export async function getReport(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  date: string,
): Promise<DayReport> {
  requirePermission(tx, P.reportRead, { propertyId });
  const row = await db(tx)
    .selectFrom('day_close.day_reports')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('business_date', '=', date)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('day_report', `${propertyId}:${date}`);
  const pack = row.pack as DayReport['pack'];
  const closed = ((pack.managerFlash as Partial<DayFacts>).revenueByChargeCode ?? []) as Array<{
    chargeCode: string;
    netMinor: number;
  }>;
  const now = await deps.ports.finance.dailyRevenue(tx, { propertyId }, { businessDate: date });
  const codes = new Set([...closed.map((c) => c.chargeCode), ...now.byChargeCode.map((c) => c.chargeCode)]);
  const revenueDelta = [...codes]
    .sort()
    .map((chargeCode) => ({
      chargeCode,
      closedMinor: closed.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
      nowMinor: now.byChargeCode.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
    }))
    .filter((d) => d.closedMinor !== d.nowMinor);
  const entries = now.restatements
    .filter((r) => r.relatesTo === date)
    .map((r) => ({
      entryId: r.entryId,
      relatesTo: r.relatesTo,
      reason: r.reason,
      amountMinor: r.amountMinor,
    }));
  return {
    id: `${propertyId}:${date}`,
    propertyId,
    businessDate: date,
    runId: row.run_id,
    generatedAt: (row.generated_at as Date).toISOString(),
    pack,
    restatementsSince: {
      asOf: tx.now.toISOString(),
      revenueDelta,
      entries,
      changed: revenueDelta.length > 0 || entries.length > 0,
    },
    links: [
      { rel: 'run', type: 'day_close_run', id: row.run_id },
      { rel: 'property', type: 'property', id: propertyId },
    ],
    provenance: tx.environment === 'live' ? 'live' : 'simulated',
  };
}

/** Portfolio board: each permitted property's business date, run status, blocking count and lag. */
export async function portfolio(deps: Deps, tx: TxContext) {
  const scope = tx.authz.propertyScope(P.runRead);
  const props = (await deps.ports.platform.listProperties(tx)).filter(
    (p) => scope === 'all' || scope.includes(p.id),
  );
  const out = [];
  for (const p of props) {
    const run = await db(tx)
      .selectFrom('day_close.runs')
      .selectAll()
      .where('property_id', '=', p.id)
      .orderBy('business_date', 'desc')
      .orderBy('started_at', 'desc')
      .executeTakeFirst();
    const last = await db(tx)
      .selectFrom('day_close.runs')
      .select(['finished_at'])
      .where('property_id', '=', p.id)
      .where('status', '=', 'completed')
      .orderBy('business_date', 'desc')
      .executeTakeFirst();
    const today = instantToZoned(tx.now, p.timezone).date;
    const lagDays = Math.max(0, diffDays(p.businessDate, today) - 1);
    const blockers =
      run?.status === 'blocked' ? ((run.failure as { blockers?: string[] })?.blockers ?? []) : null;
    out.push({
      propertyId: p.id,
      name: p.name,
      businessDate: p.businessDate,
      lagDays,
      run: run
        ? {
            id: run.id,
            propertyId: run.property_id,
            businessDate: run.business_date,
            runStatus: run.status as RunStatus,
            startedAt: (run.started_at as Date).toISOString(),
            finishedAt: run.finished_at ? (run.finished_at as Date).toISOString() : null,
            currentStep: (run.current_step as StepKey | null) ?? null,
            version: run.version,
          }
        : null,
      blockingCount: blockers ? blockers.length : null,
      lastCompletedAt: last?.finished_at ? (last.finished_at as Date).toISOString() : null,
      alert:
        lagDays >= 1
          ? `Business date ${p.businessDate} is ${lagDays} day${lagDays === 1 ? '' : 's'} behind: Day Close has not run.`
          : run?.status === 'failed'
            ? 'Day Close stopped and needs a resume.'
            : null,
    });
  }
  return { generatedAt: tx.now.toISOString(), properties: out };
}
