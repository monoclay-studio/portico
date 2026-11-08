/**
 * The data side of a rehearsal certificate (R-P1-2): the fingerprint of the source state, control totals and
 * decisions a job would import now, and the payload a production job sends to its rehearsal — built from the same
 * state, so the trial certifies exactly what the live cutover would import.
 */
import type { TxContext } from '@portico/db';
import { dataFingerprint } from '../domain/certificate';
import type { ControlTotal, SourceRecord } from '../domain/records';
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

/** Fingerprint of what this job would import now (current source state + control totals + decisions). */
export async function currentDataFingerprint(tx: TxContext, job: Job): Promise<string> {
  const rows = await db(tx)
    .selectFrom('migration.source_records')
    .select(['data_class', 'source_key', 'content_hash'])
    .where('job_id', '=', job.id)
    .where('missing_since', 'is', null)
    .execute();
  return dataFingerprint({
    records: rows.map((r) => ({ dataClass: r.data_class, key: r.source_key, hash: r.content_hash })),
    controlTotals: await currentControlTotals(tx, job),
    decisions: await decisionsFor(tx, job.id),
  });
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
