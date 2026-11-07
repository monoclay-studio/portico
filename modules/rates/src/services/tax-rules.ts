/**
 * Tax & fee rules: effective-dated, cited, verified DATA (CLAUDE.md rule 13). Versions are immutable once
 * created; activation closes the predecessor and records a change report (RAT-R25); at most one active version
 * is effective for any date (exclusion constraint). computeTaxes is the product's single tax computation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, requirePermission, ValidationError } from '@portico/kernel';
import { z } from 'zod';
import {
  type ComputeTaxesInput,
  computeTaxesInput,
  type TaxComputation,
  type TaxLine,
  type TaxRuleDto,
  taxRuleActivation,
  taxRuleDefinition,
  taxRuleInput,
  taxRuleVersionInput,
  taxTemplateInstall,
  verification,
} from '../contracts';
import { computeTaxesPure, type LoadedTaxRule, type TaxRuleVersionData } from '../domain/tax-engine';
import { RATES_EVENTS } from '../events';
import type { RatesPorts, RatesPropertyInfo } from '../ports';
import { actorKey, db, json, parseInput, parseStored, type Row } from './shared';

const today = (tx: TxContext) => tx.now.toISOString().slice(0, 10);

function toVersionDto(v: Row<'rates.tax_rule_versions'>) {
  return {
    id: v.id,
    taxRuleId: v.tax_rule_id,
    versionNo: v.version_no,
    status: v.status,
    effectiveFrom: v.effective_from,
    effectiveTo: v.effective_to,
    definition: v.definition,
    verification: parseStored(verification, v.verification, 'verification'),
    sources: v.sources as TaxRuleDto['versions'][number]['sources'],
    notes: v.notes,
    activatedAt: v.activated_at ? v.activated_at.toISOString() : null,
    activatedBy: v.activated_by,
  };
}

function toRuleDto(r: Row<'rates.tax_rules'>, versions: Array<Row<'rates.tax_rule_versions'>>): TaxRuleDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    jurisdiction: r.jurisdiction,
    category: r.category,
    propertyIds: r.property_ids,
    taxPointPolicy: r.tax_point_policy,
    ledgerMappingKey: r.ledger_mapping_key,
    sequence: r.sequence,
    status: r.status,
    version: r.version,
    versions: versions
      .filter((v) => v.tax_rule_id === r.id)
      .sort((a, b) => a.version_no - b.version_no)
      .map(toVersionDto),
  };
}

export async function listTaxRules(
  tx: TxContext,
  input: { jurisdiction?: string | undefined } = {},
): Promise<TaxRuleDto[]> {
  requirePermission(tx, 'rates.taxRule.read');
  let q = db(tx)
    .selectFrom('rates.tax_rules')
    .selectAll()
    .orderBy('jurisdiction')
    .orderBy('sequence')
    .orderBy('code');
  if (input.jurisdiction) q = q.where('jurisdiction', '=', input.jurisdiction);
  const rules = await q.execute();
  if (rules.length === 0) return [];
  const versions = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .selectAll()
    .where(
      'tax_rule_id',
      'in',
      rules.map((r) => r.id),
    )
    .execute();
  return rules.map((r) => toRuleDto(r, versions));
}

export async function getTaxRule(tx: TxContext, id: string): Promise<TaxRuleDto> {
  requirePermission(tx, 'rates.taxRule.read');
  const r = await db(tx).selectFrom('rates.tax_rules').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('tax_rule', id);
  const versions = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .selectAll()
    .where('tax_rule_id', '=', id)
    .execute();
  return toRuleDto(r, versions);
}

async function insertVersion(
  tx: TxContext,
  ruleId: string,
  versionNo: number,
  v: z.output<typeof taxRuleVersionInput>,
  status: 'draft' | 'active',
  activation?: { report: unknown },
) {
  const id = newId();
  await db(tx)
    .insertInto('rates.tax_rule_versions')
    .values({
      id,
      tenant_id: tx.tenantId,
      tax_rule_id: ruleId,
      version_no: versionNo,
      status,
      effective_from: v.effectiveFrom,
      effective_to: v.effectiveTo,
      definition: json(v.definition),
      verification: json(v.verification),
      sources: json(v.sources),
      notes: v.notes ?? null,
      created_at: tx.now,
      created_by: actorKey(tx),
      activated_at: activation ? tx.now : null,
      activated_by: activation ? actorKey(tx) : null,
      activation_report: activation ? json(activation.report) : null,
    })
    .execute();
  return id;
}

/** Create a rule with its first version as a DRAFT (activation is a separate, reviewed step). */
export async function createTaxRule(tx: TxContext, raw: unknown): Promise<TaxRuleDto> {
  requirePermission(tx, 'rates.taxRule.manage');
  const input = parseInput(taxRuleInput, raw);
  const id = newId();
  try {
    await db(tx)
      .insertInto('rates.tax_rules')
      .values({
        id,
        tenant_id: tx.tenantId,
        code: input.code,
        name: input.name,
        jurisdiction: input.jurisdiction,
        category: input.category,
        property_ids: input.propertyIds,
        tax_point_policy: input.taxPointPolicy,
        ledger_mapping_key: input.ledgerMappingKey,
        sequence: input.sequence,
        template: null,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ValidationError(
        'tax_rule_code_taken',
        `A tax or fee rule with code ${input.code} already exists. Add a new version to it instead.`,
      );
    throw err;
  }
  await insertVersion(tx, id, 1, input.firstVersion, 'draft');
  await tx.audit({ action: 'rates.taxRule.create', target: { type: 'tax_rule', id }, after: input });
  return getTaxRule(tx, id);
}

/** Draft a new version of a rule (e.g. a rate change from a date). */
export async function addTaxRuleVersion(tx: TxContext, ruleId: string, raw: unknown): Promise<TaxRuleDto> {
  requirePermission(tx, 'rates.taxRule.manage');
  const input = parseInput(taxRuleVersionInput, raw);
  const rule = await db(tx)
    .selectFrom('rates.tax_rules')
    .selectAll()
    .where('id', '=', ruleId)
    .forUpdate()
    .executeTakeFirst();
  if (!rule) throw new NotFoundError('tax_rule', ruleId);
  const max = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .select((eb) => eb.fn.max('version_no').as('n'))
    .where('tax_rule_id', '=', ruleId)
    .executeTakeFirst();
  const versionNo = Number(max?.n ?? 0) + 1;
  const versionId = await insertVersion(tx, ruleId, versionNo, input, 'draft');
  await tx.audit({
    action: 'rates.taxRule.addVersion',
    target: { type: 'tax_rule_version', id: versionId },
    after: { ruleCode: rule.code, versionNo, ...input },
  });
  return getTaxRule(tx, ruleId);
}

export interface TaxActivationReport {
  ruleCode: string;
  ruleVersionId: string;
  versionNo: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verificationStatus: string;
  closes: Array<{
    ruleVersionId: string;
    versionNo: number;
    effectiveFrom: string | null;
    effectiveToBefore: string | null;
    effectiveToAfter: string;
  }>;
  conflicts: Array<{
    ruleVersionId: string;
    versionNo: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    reason: string;
  }>;
  definitionChanges: Array<{ field: string; before: unknown; after: unknown }>;
  warnings: string[];
  impact: string[];
  generatedAt: string;
}

async function buildActivationReport(tx: TxContext, versionId: string) {
  const v = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .selectAll()
    .where('id', '=', versionId)
    .executeTakeFirst();
  if (!v) throw new NotFoundError('tax_rule_version', versionId);
  const rule = await db(tx)
    .selectFrom('rates.tax_rules')
    .selectAll()
    .where('id', '=', v.tax_rule_id)
    .executeTakeFirstOrThrow();
  const active = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .selectAll()
    .where('tax_rule_id', '=', v.tax_rule_id)
    .where('status', '=', 'active')
    .where('id', '<>', v.id)
    .execute();
  const lt = (a: string | null, b: string | null) => (a === null ? b !== null : b !== null && a < b); // null start = −∞
  const report: TaxActivationReport = {
    ruleCode: rule.code,
    ruleVersionId: v.id,
    versionNo: v.version_no,
    effectiveFrom: v.effective_from,
    effectiveTo: v.effective_to,
    verificationStatus: parseStored(verification, v.verification, 'verification').status,
    closes: [],
    conflicts: [],
    definitionChanges: [],
    warnings: [],
    impact: [],
    generatedAt: tx.now.toISOString(),
  };
  let predecessor: Row<'rates.tax_rule_versions'> | null = null;
  for (const a of active) {
    const overlaps =
      (a.effective_to === null || v.effective_from === null || a.effective_to > v.effective_from) &&
      (v.effective_to === null || a.effective_from === null || v.effective_to > a.effective_from);
    if (!overlaps) {
      if (a.effective_to !== null && v.effective_from !== null && a.effective_to <= v.effective_from) {
        if (!predecessor || lt(predecessor.effective_from, a.effective_from)) predecessor = a;
      }
      continue;
    }
    const startsBefore = v.effective_from !== null && lt(a.effective_from, v.effective_from);
    const endsWithin =
      v.effective_to === null || (a.effective_to !== null && a.effective_to <= v.effective_to);
    if (startsBefore && endsWithin) {
      report.closes.push({
        ruleVersionId: a.id,
        versionNo: a.version_no,
        effectiveFrom: a.effective_from,
        effectiveToBefore: a.effective_to,
        effectiveToAfter: v.effective_from as string,
      });
      predecessor = a;
    } else {
      report.conflicts.push({
        ruleVersionId: a.id,
        versionNo: a.version_no,
        effectiveFrom: a.effective_from,
        effectiveTo: a.effective_to,
        reason: startsBefore
          ? 'The new version would split this active version in two. Give the new version no end date, or draft a successor for the remainder.'
          : 'This active version starts on or after the new version. Withdraw it first (only possible before it takes effect) or end the new version before it starts.',
      });
    }
  }
  if (predecessor) {
    const before = predecessor.definition as Record<string, unknown>;
    const after = v.definition as Record<string, unknown>;
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
        report.definitionChanges.push({ field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  if (v.effective_from !== null && v.effective_from < today(tx)) {
    report.warnings.push(
      `This version takes effect in the past (${v.effective_from}). Charges already posted keep the rule version they used; any correction is a finance adjustment, never a silent recalculation.`,
    );
  }
  if (report.verificationStatus !== 'verified') {
    report.warnings.push(
      'This version is not confirmed by a qualified adviser; a live property cannot issue fiscal documents from unconfirmed rules.',
    );
  }
  report.impact.push(
    "Agreed stays keep their agreed prices. Taxes for supplies whose tax point falls inside this version's dates use it; amounts whose tax point is already fixed (e.g. deposits taxed at payment) are not re-taxed.",
    `Tax point policy of ${rule.code}: ${rule.tax_point_policy}.`,
    'Affected future stays and deposits are listed by reservations/finance from the rates.taxRule.activated event (rates does not read bookings).',
  );
  return { v, rule, report };
}

export async function previewTaxRuleActivation(
  tx: TxContext,
  versionId: string,
): Promise<TaxActivationReport> {
  requirePermission(tx, 'rates.taxRule.activate');
  return (await buildActivationReport(tx, versionId)).report;
}

export async function activateTaxRuleVersion(
  tx: TxContext,
  versionId: string,
  raw: unknown,
): Promise<TaxActivationReport> {
  requirePermission(tx, 'rates.taxRule.activate');
  const { reason, acknowledgeReport } = parseInput(taxRuleActivation, raw);
  if (!acknowledgeReport) {
    throw new ValidationError(
      'activation_report_not_acknowledged',
      'Review the change report (preview) and confirm acknowledgeReport before activating.',
    );
  }
  const { v, rule, report } = await buildActivationReport(tx, versionId);
  if (v.status !== 'draft')
    throw new BusinessRuleError(
      'tax_rule_version_not_draft',
      `Version ${v.version_no} of ${rule.code} is ${v.status}; only drafts can be activated.`,
    );
  if (report.conflicts.length > 0) {
    throw new BusinessRuleError(
      'tax_rule_version_conflict',
      `Version ${v.version_no} of ${rule.code} overlaps active versions that cannot be closed automatically.`,
      { conflicts: report.conflicts },
    );
  }
  for (const c of report.closes) {
    await db(tx)
      .updateTable('rates.tax_rule_versions')
      .set({ effective_to: c.effectiveToAfter })
      .where('id', '=', c.ruleVersionId)
      .execute();
  }
  await db(tx)
    .updateTable('rates.tax_rule_versions')
    .set({
      status: 'active',
      activated_at: tx.now,
      activated_by: actorKey(tx),
      activation_report: json(report),
    })
    .where('id', '=', v.id)
    .execute();
  await tx.audit({
    action: 'rates.taxRule.activate',
    target: { type: 'tax_rule_version', id: v.id },
    reason,
    after: report,
  });
  await tx.emit({
    type: RATES_EVENTS.taxRuleActivated,
    aggregate: { type: 'tax_rule', id: rule.id },
    payload: {
      taxRuleId: rule.id,
      ruleCode: rule.code,
      ruleVersionId: v.id,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      supersededVersionId: report.closes[0]?.ruleVersionId ?? null,
    },
  });
  return report;
}

/** Withdraw a draft, or an active version that has not taken effect yet (it cannot have been used). */
export async function withdrawTaxRuleVersion(
  tx: TxContext,
  versionId: string,
  raw: unknown,
): Promise<TaxRuleDto> {
  requirePermission(tx, 'rates.taxRule.activate');
  const { reason } = parseInput(z.object({ reason: z.string().min(3).max(500) }), raw);
  const v = await db(tx)
    .selectFrom('rates.tax_rule_versions')
    .selectAll()
    .where('id', '=', versionId)
    .forUpdate()
    .executeTakeFirst();
  if (!v) throw new NotFoundError('tax_rule_version', versionId);
  if (v.status === 'withdrawn') return getTaxRule(tx, v.tax_rule_id);
  if (v.status === 'active' && (v.effective_from === null || v.effective_from <= today(tx))) {
    throw new BusinessRuleError(
      'tax_rule_version_in_use',
      'This version is already in effect and may have been used for charges. Draft a new version from a future date instead.',
    );
  }
  await db(tx)
    .updateTable('rates.tax_rule_versions')
    .set({ status: 'withdrawn' })
    .where('id', '=', v.id)
    .execute();
  if (v.status === 'active' && v.effective_from) {
    // Re-open the predecessor that activation had closed at this version's start.
    await db(tx)
      .updateTable('rates.tax_rule_versions')
      .set({ effective_to: v.effective_to })
      .where('tax_rule_id', '=', v.tax_rule_id)
      .where('status', '=', 'active')
      .where('effective_to', '=', v.effective_from)
      .execute();
  }
  await tx.audit({
    action: 'rates.taxRule.withdrawVersion',
    target: { type: 'tax_rule_version', id: v.id },
    reason,
    before: { status: v.status },
  });
  return getTaxRule(tx, v.tax_rule_id);
}

// ───────────────────────────── Loading rules for computation ─────────────────────────────

export function toVersionData(v: Row<'rates.tax_rule_versions'>): TaxRuleVersionData {
  return {
    id: v.id,
    effectiveFrom: v.effective_from,
    effectiveTo: v.effective_to,
    definition: parseStored(taxRuleDefinition, v.definition, 'tax rule definition'),
    verificationStatus: parseStored(verification, v.verification, 'verification').status,
  };
}

/** Active rules (and their active versions) that apply to a property, or exactly the pinned versions. */
export async function loadTaxRulesForProperty(
  tx: TxContext,
  property: Pick<RatesPropertyInfo, 'id' | 'countryCode'>,
  opts: { ruleVersionIds?: readonly string[] | undefined } = {},
): Promise<LoadedTaxRule[]> {
  const pinned = opts.ruleVersionIds;
  const versions = pinned
    ? pinned.length === 0
      ? []
      : await db(tx)
          .selectFrom('rates.tax_rule_versions')
          .selectAll()
          .where('id', 'in', [...pinned])
          .execute()
    : null;
  if (pinned && versions && versions.length !== new Set(pinned).size) {
    throw new ValidationError('tax_rule_version_not_found', 'Some pinned tax rule versions do not exist.');
  }
  let q = db(tx).selectFrom('rates.tax_rules').selectAll();
  if (versions) {
    if (versions.length === 0) return [];
    q = q.where(
      'id',
      'in',
      versions.map((v) => v.tax_rule_id),
    );
  } else {
    q = q
      .where('status', '=', 'active')
      .where((eb) =>
        eb.or([
          eb.and([
            eb('jurisdiction', '=', property.countryCode),
            eb.or([eb('property_ids', 'is', null), eb(eb.val(property.id), '=', eb.fn.any('property_ids'))]),
          ]),
          eb.and([
            eb('jurisdiction', 'like', `${property.countryCode}-%`),
            eb(eb.val(property.id), '=', eb.fn.any('property_ids')),
          ]),
        ]),
      );
  }
  const rules = await q.execute();
  if (rules.length === 0) return [];
  const all =
    versions ??
    (await db(tx)
      .selectFrom('rates.tax_rule_versions')
      .selectAll()
      .where(
        'tax_rule_id',
        'in',
        rules.map((r) => r.id),
      )
      .where('status', '=', 'active')
      .execute());
  return rules.map((r) => ({
    rule: {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      taxPointPolicy: r.tax_point_policy,
      ledgerMappingKey: r.ledger_mapping_key,
      sequence: r.sequence,
    },
    versions: all.filter((v) => v.tax_rule_id === r.id).map(toVersionData),
    ...(versions ? { pinned: true } : {}),
  }));
}

/** Provider: the single tax computation, with per-line nets (inclusive decomposition) and totals. */
export async function computeTaxesDetailed(
  ports: RatesPorts,
  tx: TxContext,
  raw: ComputeTaxesInput,
): Promise<TaxComputation> {
  const input = parseInput(computeTaxesInput, raw);
  const property = await ports.getProperty(tx, input.propertyId);
  const rules = await loadTaxRulesForProperty(tx, property, { ruleVersionIds: input.ruleVersionIds });
  return computeTaxesPure(rules, input.lines, {
    classification: property.classification,
    occupancy: input.occupancy,
    stayContext: input.stayContext,
    invoiceDate: input.invoiceDate,
    paymentDate: input.paymentDate,
    fxRates: input.fxRates,
    exemptionCertificates: input.exemptionCertificates,
  });
}

/** Provider (domain map): computeTaxes → per-line tax lines with rule versions. */
export async function computeTaxes(
  ports: RatesPorts,
  tx: TxContext,
  raw: ComputeTaxesInput,
): Promise<TaxLine[]> {
  return (await computeTaxesDetailed(ports, tx, raw)).lines.flatMap((l) => l.taxes);
}

// ───────────────────────────── Templates (seed data) ─────────────────────────────

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
const TEMPLATE_FILES: Record<string, string> = { MV: 'mv-tax-pack.json' };

const templateSchema = z.object({
  template: z.string(),
  templateVersion: z.string(),
  jurisdiction: z.string(),
  disclaimer: z.string(),
  rules: z.array(
    taxRuleInput
      .omit({ firstVersion: true, jurisdiction: true, propertyIds: true })
      .extend({ versions: z.array(taxRuleVersionInput).min(1) }),
  ),
});

export function loadTaxTemplate(code: string) {
  const file = TEMPLATE_FILES[code];
  if (!file) throw new ValidationError('unknown_tax_template', `There is no tax template "${code}".`);
  return templateSchema.parse(JSON.parse(readFileSync(join(TEMPLATE_DIR, file), 'utf8')));
}

/**
 * Install a jurisdiction's rule pack as data. Idempotent per rule code: existing rules are left untouched and
 * reported as skipped (a template never overwrites a tenant's own rules or versions).
 */
export async function installTaxTemplate(
  tx: TxContext,
  raw: unknown,
): Promise<{ template: string; installed: string[]; skipped: string[]; disclaimer: string }> {
  requirePermission(tx, 'rates.taxRule.manage');
  requirePermission(tx, 'rates.taxRule.activate');
  const input = parseInput(taxTemplateInstall, raw);
  const t = loadTaxTemplate(input.template);
  const existing = await db(tx)
    .selectFrom('rates.tax_rules')
    .select('code')
    .where(
      'code',
      'in',
      t.rules.map((r) => r.code),
    )
    .execute();
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const r of t.rules) {
    if (existing.some((e) => e.code === r.code)) {
      skipped.push(r.code);
      continue;
    }
    const id = newId();
    await db(tx)
      .insertInto('rates.tax_rules')
      .values({
        id,
        tenant_id: tx.tenantId,
        code: r.code,
        name: r.name,
        jurisdiction: t.jurisdiction,
        category: r.category,
        property_ids: input.propertyIds,
        tax_point_policy: r.taxPointPolicy,
        ledger_mapping_key: r.ledgerMappingKey,
        sequence: r.sequence,
        template: `${t.template}@${t.templateVersion}`,
      })
      .execute();
    let n = 0;
    for (const v of r.versions) {
      n++;
      const versionId = await insertVersion(tx, id, n, v, 'active', {
        report: {
          installedFrom: `${t.template}@${t.templateVersion}`,
          disclaimer: t.disclaimer,
          generatedAt: tx.now.toISOString(),
        },
      });
      await tx.emit({
        type: RATES_EVENTS.taxRuleActivated,
        aggregate: { type: 'tax_rule', id },
        payload: {
          taxRuleId: id,
          ruleCode: r.code,
          ruleVersionId: versionId,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
          supersededVersionId: null,
        },
      });
    }
    installed.push(r.code);
  }
  await tx.audit({
    action: 'rates.taxRule.installTemplate',
    target: { type: 'tax_template', id: `${t.template}@${t.templateVersion}` },
    after: { installed, skipped, propertyIds: input.propertyIds },
  });
  return { template: `${t.template}@${t.templateVersion}`, installed, skipped, disclaimer: t.disclaimer };
}
