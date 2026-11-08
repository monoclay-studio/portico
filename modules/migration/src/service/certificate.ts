/**
 * The data side of a rehearsal certificate (R-P1-2): the fingerprint of the source state, control totals and
 * decisions a job would import now, and the payload a production job sends to its rehearsal — built from the same
 * state, so the trial certifies exactly what the live cutover would import.
 */
import type { TxContext } from '@portico/db';
import { dataFingerprint } from '../domain/certificate';
import { type ControlTotal, type DataClass, FINANCIAL_CLASSES, type SourceRecord } from '../domain/records';
import { db, type Job } from './context';
import { decisionsOf } from './exceptions';
import { currentControlTotals } from './importer';
import { loadSourceRecords } from './state';

async function decisionsFor(tx: TxContext, jobId: string) {
  return (await decisionsOf(tx, jobId)).map((d) => ({
    dataClass: d.data_class,
    sourceKey: d.source_key,
    code: d.code,
    outcome: d.outcome as string,
    resolution: d.resolution,
  }));
}

async function fingerprintParts(tx: TxContext, job: Job, money: boolean): Promise<string> {
  const rows = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'content_hash'])
    .where('job_id', '=', job.id)
    .where('missing_since', 'is', null)
    .execute();
  const isMoney = (c: string) => FINANCIAL_CLASSES.has(c as DataClass);
  return dataFingerprint({
    records: rows
      .filter((r) => isMoney(r.data_class) === money)
      .map((r) => ({ dataClass: r.data_class, key: r.source_key, hash: r.content_hash })),
    controlTotals: (await currentControlTotals(tx, job)).filter((t) => isMoney(t.dataClass) === money),
    decisions: (await decisionsFor(tx, job.id)).filter((d) => isMoney(d.dataClass) === money),
  });
}

/**
 * Fingerprint of what the rehearsal certificate binds (R-P1-2): the current source state, control totals and
 * decisions of every class except opening money. Opening money (deposits, folio balances, receivables) is bound by
 * finance's confirmation instead (`currentMoneyFingerprint`): it changes every day until the cutover, posted money is
 * immutable in the trial copy (a rehearsal cannot re-post it), and the verify step reconciles it exactly after the
 * switch.
 */
export async function currentDataFingerprint(tx: TxContext, job: Job): Promise<string> {
  return fingerprintParts(tx, job, false);
}

/** Fingerprint of the opening money (records, control totals, finance decisions) finance confirms (R-P1-8). */
export async function currentMoneyFingerprint(tx: TxContext, job: Job): Promise<string> {
  return fingerprintParts(tx, job, true);
}

export interface RehearsalPayload {
  seq: number;
  records: SourceRecord[];
  controlTotals: ControlTotal[];
  decisions: Awaited<ReturnType<typeof decisionsFor>>;
  /** What the trial must certify for this payload to count (computed from the same state). */
  dataFingerprint: string;
}

/** Everything a rehearsal needs to import exactly what the cutover would: records, control totals, decisions. */
export async function rehearsalPayload(tx: TxContext, job: Job): Promise<RehearsalPayload> {
  const last = await db(tx)
    .selectFrom('migration.extracts')
    .select((eb) => eb.fn.max('seq').as('seq'))
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  return {
    seq: Number(last?.seq ?? 0),
    records: await loadSourceRecords(tx, job.id),
    controlTotals: await currentControlTotals(tx, job),
    decisions: await decisionsFor(tx, job.id),
    dataFingerprint: await currentDataFingerprint(tx, job),
  };
}
