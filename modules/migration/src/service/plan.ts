/**
 * Map step (phase M1) and quality checks (phase M2).
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, requirePermission, ValidationError } from '@portico/kernel';
import type { ReviewMappingInput } from '../contracts';
import {
  type MigrationPlan,
  pendingReview,
  planFingerprint,
  suggestRatePlans,
  suggestTaxAccounts,
  suggestUnitTypes,
} from '../domain/mapping';
import { checkAgainstImported, checkQuality, recordId } from '../domain/quality';
import {
  type DepositRecord,
  FINANCIAL_CLASSES,
  type RatePlanRecord,
  type ReservationRecord,
  type SourceRecord,
  type UnitRecord,
  type UnitTypeRecord,
} from '../domain/records';
import { MASKED_FILE_THRESHOLD } from '../domain/sensitive';
import { P } from '../manifest';
import { actorKey, assertOpen, db, type Job, loadJobFor, type MigrationDeps, saveJob } from './context';
import { loadExtracts, materialize, rematerialize } from './extract';
import { impliedUnitTypes } from './importer';
import {
  closeCorrected,
  exceptionDecisions,
  importability,
  loadAllParsedRecords,
  loadLedger,
  loadParsedRecords,
  loadSourceRecords,
  raiseException,
} from './state';

/** Recompute suggestions from the current source state, keeping every reviewed decision. */
export async function computePlan(tx: TxContext, deps: MigrationDeps, job: Job): Promise<MigrationPlan> {
  const records0 = await loadSourceRecords(tx, job.id);
  const records = [...records0, ...impliedUnitTypes(records0)];
  const of = <T>(c: SourceRecord['dataClass']) =>
    records.filter((r) => r.dataClass === c && r.payload).map((r) => r.payload as T);
  const unitTypes = of<UnitTypeRecord>('unit_type').map((u) => ({ code: u.code, name: u.name }));
  const ratePlans = new Map<string, string>();
  for (const p of of<RatePlanRecord>('rate_plan')) ratePlans.set(p.code, p.name);
  for (const r of of<ReservationRecord>('reservation'))
    if (r.ratePlanCode && !ratePlans.has(r.ratePlanCode)) ratePlans.set(r.ratePlanCode, r.ratePlanCode);
  const taxCodes = of<DepositRecord>('deposit').flatMap((d) => d.taxDeclared.map((t) => t.code));
  const existingTypes = await deps.ports.inventory.listUnitTypes(tx, job.propertyId);
  const existingPlans = await deps.ports.rates.listRatePlans(tx, job.propertyId);
  const taxAccounts = taxCodes.length ? await deps.ports.finance.taxAccountKeys(tx, job.propertyId) : [];
  // Unknown status words and ambiguous date columns surface when the extracts are read with the current plan.
  const unknownStatuses = new Set<string>();
  const ambiguous = new Set<string>();
  for (const e of await loadExtracts(tx, job.id)) {
    const m = materialize(e, job.plan);
    for (const s of m.unknownStatuses) unknownStatuses.add(s);
    for (const a of m.ambiguousDateColumns) ambiguous.add(a);
  }
  const statuses = [
    ...job.plan.statuses.filter((s) => s.status),
    ...[...unknownStatuses]
      .filter((w) => !job.plan.statuses.some((s) => s.sourceWord === w && s.status))
      .map((w) => ({ sourceWord: w, status: null, reviewedBy: null })),
  ];
  return {
    ...job.plan,
    unitTypes: suggestUnitTypes(unitTypes, existingTypes, job.plan.unitTypes),
    ratePlans: suggestRatePlans(
      [...ratePlans].map(([code, name]) => ({ code, name })),
      existingPlans,
      job.plan.ratePlans,
    ),
    statuses,
    taxAccounts: suggestTaxAccounts(taxCodes, taxAccounts, job.plan.taxAccounts),
    ambiguousDateColumns: [...ambiguous],
  };
}

/** The map step: suggestions saved; waits while any decision needs a person. */
export async function runMapStep(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
): Promise<{ job: Job; waiting: string | null; owner: string | null }> {
  const plan = await computePlan(tx, deps, job);
  const next = await saveJob(tx, job, { plan, planFingerprint: planFingerprint(plan) });
  const pending = pendingReview(plan);
  if (pending.length === 0) return { job: next, waiting: null, owner: null };
  const financial = pending.some((p) => p.financial);
  return {
    job: next,
    waiting: `${pending.length} mapping decision(s) need a person: ${pending
      .slice(0, 3)
      .map((p) => p.reason)
      .join(' ')}`,
    owner: financial ? 'Finance controller (tax mappings) and migration lead' : 'Migration lead',
  };
}

/** A person decides mappings. Tax accounts are financially significant: finance only (INT-R11). */
export async function reviewMapping(
  tx: TxContext,
  deps: MigrationDeps,
  jobId: string,
  input: ReviewMappingInput,
): Promise<Job> {
  let job = await loadJobFor(tx, jobId, P.mappingReview, { lock: true });
  assertOpen(job);
  if (job.frozenAt)
    throw new BusinessRuleError(
      'mapping_frozen',
      'The cutover has started; the mapping can no longer change.',
    );
  if (input.taxAccounts?.length) requirePermission(tx, P.financeSignoff, { propertyId: job.propertyId });
  const who = actorKey(tx);
  const plan: MigrationPlan = structuredClone(job.plan);
  const existingTypes = input.unitTypes?.some((u) => u.action === 'map')
    ? await deps.ports.inventory.listUnitTypes(tx, job.propertyId)
    : [];
  for (const u of input.unitTypes ?? []) {
    const d = plan.unitTypes.find((x) => x.sourceCode === u.sourceCode);
    if (!d)
      throw new ValidationError('unknown_source_code', `Unit type ${u.sourceCode} is not in the source.`);
    if (u.action === 'map') {
      const target = existingTypes.find((t) => t.code === u.targetCode);
      if (!target)
        throw new ValidationError(
          'unknown_target',
          `Portico has no unit type ${u.targetCode} at this property.`,
        );
      Object.assign(d, { action: 'map', targetCode: target.code, targetId: target.id });
    } else Object.assign(d, { action: 'create', targetCode: u.targetCode, targetId: null });
    d.reviewedBy = who;
    d.confidence = 1;
  }
  if (input.ratePlans?.length) {
    const plans = await deps.ports.rates.listRatePlans(tx, job.propertyId);
    for (const r of input.ratePlans) {
      const d = plan.ratePlans.find((x) => x.sourceCode === r.sourceCode);
      if (!d)
        throw new ValidationError('unknown_source_code', `Rate plan ${r.sourceCode} is not in the source.`);
      if (r.action === 'map') {
        const target = plans.find((p) => p.code === r.targetCode);
        if (!target) throw new ValidationError('unknown_target', `Portico has no rate plan ${r.targetCode}.`);
        Object.assign(d, { action: 'map', targetCode: target.code, targetId: target.id });
      } else Object.assign(d, { action: 'not_in_portico', targetCode: null, targetId: null });
      d.reviewedBy = who;
      d.confidence = 1;
    }
  }
  let reparse = false;
  for (const s of input.statuses ?? []) {
    const word = s.sourceWord.trim().toLowerCase();
    const d = plan.statuses.find((x) => x.sourceWord === word);
    if (d) Object.assign(d, { status: s.status, reviewedBy: who });
    else plan.statuses.push({ sourceWord: word, status: s.status, reviewedBy: who });
    reparse = true;
  }
  if (input.taxAccounts?.length) {
    const accounts = await deps.ports.finance.taxAccountKeys(tx, job.propertyId);
    for (const t of input.taxAccounts) {
      if (!accounts.includes(t.accountKey))
        throw new ValidationError(
          'unknown_tax_account',
          `${t.accountKey} is not a tax account of this property's legal entity. Choose one of: ${accounts.join(', ')}.`,
        );
      const d = plan.taxAccounts.find((x) => x.sourceCode === t.sourceCode);
      if (!d) throw new ValidationError('unknown_source_code', `Tax ${t.sourceCode} is not in the source.`);
      Object.assign(d, { accountKey: t.accountKey, confidence: 1, reviewedBy: who });
    }
  }
  if (input.dateOrder) {
    plan.dateOrder = input.dateOrder;
    plan.dateOrderReviewedBy = who;
    reparse = true;
  }
  const before = job.planFingerprint;
  const steps = { ...job.steps };
  for (const s of ['map', 'validate', 'rehearse', 'reconcile', 'signoff'] as const) steps[s] = 'pending';
  job = await saveJob(tx, job, {
    plan,
    planFingerprint: planFingerprint(plan),
    steps,
    // A rehearsal certifies one plan: a changed plan must be rehearsed again.
    ...(job.purpose === 'rehearsal' && job.certificate ? { certificate: null } : {}),
  });
  if (reparse) await rematerialize(tx, job);
  await tx.audit({
    action: 'migration.mapping.review',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    before: { planFingerprint: before },
    after: { planFingerprint: job.planFingerprint, decisions: input },
  });
  return job;
}

/** Quality checks (M2): problems become exceptions with owners; problems no longer present are closed. */
export async function runValidateStep(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
): Promise<{ blocking: number; warnings: number; undecided: number }> {
  const parsed = await loadParsedRecords(tx, job.id);
  // Unit types derived from reservation codes carry their own warning (listed so a person reviews them).
  const records = [...parsed, ...impliedUnitTypes(parsed)];
  const property = await deps.ports.platform.getProperty(tx, job.propertyId);
  const knownUnitTypes = new Set(job.plan.unitTypes.map((u) => u.sourceCode));
  const unitsPerType = new Map<string, number>();
  for (const r of records)
    if (r.dataClass === 'unit' && r.payload) {
      const u = r.payload as UnitRecord;
      unitsPerType.set(u.unitTypeCode, (unitsPerType.get(u.unitTypeCode) ?? 0) + 1);
    }
  const findings = checkQuality(records, {
    businessDate: property.businessDate,
    knownUnitTypes,
    unitsPerType,
  });
  // Records already in Portico (this source's ledger) vs records not imported yet: a re-keyed copy is never
  // imported automatically (R-P1-5). After the switch, money is never posted without finance (R-P1-8).
  const ledger = await loadLedger(tx, job);
  const isImported = (r: { dataClass: string; key: string }) => {
    const l = ledger.get(`${r.dataClass}:${r.key}`);
    return l?.state === 'imported' || l?.state === 'merged';
  };
  const candidates = records.filter((r) => !isImported(r));
  // Only after the switch: before it, a production job has imported nothing in live, and a rehearsal must import
  // exactly what the live cutover will (its earlier rounds are not "already in Portico" for the cutover).
  if (job.switchedAt)
    for (const [id, list] of checkAgainstImported(
      candidates,
      (await loadAllParsedRecords(tx, job.id)).filter(isImported),
    ))
      findings.set(id, [...(findings.get(id) ?? []), ...list]);
  if (job.switchedAt)
    for (const r of candidates)
      if (FINANCIAL_CLASSES.has(r.dataClass) && r.payload) {
        const id = recordId(r.dataClass, r.key);
        findings.set(id, [
          ...(findings.get(id) ?? []),
          {
            code: 'post_switch_money',
            severity: 'blocking',
            message:
              'Opening money read after the switch to Portico. It is not posted until finance confirms it (import as is posts it once; exclude keeps it out).',
          },
        ]);
      }
  // Quality findings are replaced wholesale on every validation (a finding that disappeared is gone).
  await db(tx)
    .updateTable('migration.source_records')
    .set({ quality: '[]' })
    .where('job_id', '=', job.id)
    .execute();
  const present = new Set<string>();
  let blocking = 0;
  let warnings = 0;
  for (const r of records) {
    const quality = findings.get(recordId(r.dataClass, r.key)) ?? [];
    if (quality.length)
      await db(tx)
        .updateTable('migration.source_records')
        .set({ quality: JSON.stringify(quality) })
        .where('job_id', '=', job.id)
        .where('data_class', '=', r.dataClass)
        .where('source_key', '=', r.key)
        .execute();
    for (const p of [...r.problems, ...quality]) {
      present.add(`${r.dataClass}:${r.key}:${p.code}`);
      await raiseException(tx, job, {
        dataClass: r.dataClass,
        key: r.key,
        code: p.code,
        severity: p.severity,
        problem: `${p.message}${r.origin.row ? ` (${r.origin.file}, row ${r.origin.row})` : ''}`,
      });
      if (p.severity === 'blocking') blocking++;
      else warnings++;
    }
  }
  // A largely masked export (OPERA over insecure delivery, Little Hotelier after 180 days) is refused as a whole.
  const people = records.filter((r) => r.dataClass === 'guest' || r.dataClass === 'reservation');
  const masked = people.filter((r) => r.problems.some((p) => p.code === 'masked_identity')).length;
  if (people.length > 0 && masked / people.length > MASKED_FILE_THRESHOLD) {
    present.add('guest::masked_export');
    await raiseException(tx, job, {
      dataClass: 'guest',
      key: null,
      code: 'masked_export',
      severity: 'blocking',
      problem: `${masked} of ${people.length} guest and reservation records have masked names. This export is masked; masked data is never imported as truth.`,
      impact: 'The masked records are not imported, and the cutover waits.',
      proposedResolution:
        'Re-export with unmasked personal data over a secure delivery (SFTP or HTTPS; for OPERA, the secure export delivery) and upload it again.',
      ownerRole: 'Hotel IT or general manager',
    });
    blocking++;
  }
  // Close record problems that disappeared (never reconciliation, provider or decision exceptions).
  await closeCorrected(tx, job, present, { only: problemCodesOf(records, findings) });
  // What holds the cutover is what would NOT be imported without a person's decision — the same verdict the
  // importer and the rehearsal use (R-P1-4): decided records (import as is, excluded, loss, deferred) never hold it.
  const decisions = await exceptionDecisions(tx, job.id);
  let undecided = 0;
  for (const r of records) {
    const quality = findings.get(recordId(r.dataClass, r.key)) ?? [];
    const v = importability(
      { problems: [...r.problems, ...quality], payload: r.payload },
      decisions.get(`${r.dataClass}:${r.key}`),
    );
    if (v.verdict === 'exception' && !v.deferred) undecided++;
  }
  const maskedOpen = decisions.get('guest:')?.get('masked_export');
  if (maskedOpen && (maskedOpen.status === 'open' || maskedOpen.status === 'in_progress')) undecided++;
  return { blocking, warnings, undecided };
}

function problemCodesOf(records: SourceRecord[], findings: Map<string, { code: string }[]>): Set<string> {
  const codes = new Set<string>(KNOWN_RECORD_CODES);
  for (const r of records) for (const p of r.problems) codes.add(p.code);
  for (const list of findings.values()) for (const p of list) codes.add(p.code);
  return codes;
}

/** Every problem code produced by parsing and quality checks (so a corrected one can be closed). */
const KNOWN_RECORD_CODES = [
  'required_missing',
  'date_ambiguous',
  'date_invalid',
  'amount_invalid',
  'amount_too_precise',
  'amount_ambiguous_separator',
  'currency_invalid',
  'masked_identity',
  'masked_contact',
  'contact_invalid',
  'status_unmapped',
  'total_mismatch',
  'dates_inverted',
  'nightly_invalid',
  'nightly_incomplete',
  'nightly_total_mismatch',
  'folio_not_balancing',
  'unreadable_row',
  'duplicate_key_conflict',
  'duplicate_channel_booking',
  'unit_type_unmapped',
  'future_stay_in_past',
  'in_house_dates',
  'prepaid_without_deposit',
  'unit_double_assigned',
  'overbooked_in_source',
  'deposit_without_booking',
  'deposit_currency_mismatch',
  'deposit_on_inactive_booking',
  'deposit_not_positive',
  'balance_without_in_house_stay',
  'balance_currency_mismatch',
  'in_house_without_balance',
  'possible_duplicate_profile',
  'unit_type_derived',
  'masked_export',
  'rekeyed_channel_booking',
  'possible_duplicate_booking',
  'post_switch_money',
];
