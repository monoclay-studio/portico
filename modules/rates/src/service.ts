/**
 * Rates application services, bound to their ports. The composition root creates one instance:
 *   const rates = ratesService(ports)
 * and binds other modules' ports to its providers (quote, priceChange, computeTaxes, getRatePlan, …).
 */
import type { TxContext } from '@portico/db';
import type { ComputeTaxesInput, TermsSnapshot } from './contracts';
import { postingPlan, verifyTerms } from './domain/terms';
import type { RatesPorts } from './ports';
import * as calendar from './services/calendar';
import * as catalog from './services/catalog';
import * as quoting from './services/quote';
import * as plans from './services/rate-plans';
import * as records from './services/records';
import * as taxes from './services/tax-rules';

export function ratesService(ports: RatesPorts) {
  return {
    // ── Providers (docs/architecture/domain-map.md § rates) ──
    quote: (tx: TxContext, request: unknown) => quoting.quote(ports, tx, request),
    quoteDetailed: (tx: TxContext, request: unknown) => quoting.quoteDetailed(ports, tx, request),
    priceChange: (tx: TxContext, input: unknown) => quoting.priceChange(ports, tx, input),
    computeTaxes: (tx: TxContext, input: ComputeTaxesInput) => taxes.computeTaxes(ports, tx, input),
    computeTaxesDetailed: (tx: TxContext, input: ComputeTaxesInput) => taxes.computeTaxesDetailed(ports, tx, input),
    getRatePlan: plans.getRatePlan,
    listRatePlans: plans.listRatePlans,
    recordPlanSale: quoting.recordPlanSale,
    releasePlanSale: quoting.releasePlanSale,
    /** Pure: charge lines to post for agreed terms (no configuration read). */
    postingPlan: (terms: TermsSnapshot, stayId: string) => postingPlan(terms, stayId),
    verifyTerms: (terms: TermsSnapshot) => verifyTerms(terms),

    // ── Universal record views (status per family, next actions, issues, links) ──
    ratePlanRecord: (tx: TxContext, plan: Parameters<typeof records.ratePlanRecord>[2]) => records.ratePlanRecord(ports, tx, plan),
    ratePlanRecords: (tx: TxContext, propertyId: string, list: Parameters<typeof records.ratePlanRecords>[3]) =>
      records.ratePlanRecords(ports, tx, propertyId, list),
    taxRuleRecord: records.taxRuleRecord,

    // ── Rate plans ──
    createRatePlan: (tx: TxContext, input: unknown) => plans.createRatePlan(ports, tx, input),
    updateRatePlan: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      plans.updateRatePlan(ports, tx, id, expectedVersion, patch),
    changeRatePlanStatus: (tx: TxContext, id: string, expectedVersion: number, input: unknown) =>
      plans.changeRatePlanStatus(ports, tx, id, expectedVersion, input),

    // ── Calendar ──
    previewPriceUpdate: (tx: TxContext, input: unknown) => calendar.previewPriceUpdate(ports, tx, input),
    applyPriceUpdate: (tx: TxContext, input: unknown) => calendar.applyPriceUpdate(ports, tx, input),
    getPriceCalendar: calendar.getPriceCalendar,
    getPriceHistory: calendar.getPriceHistory,
    previewRestrictionUpdate: (tx: TxContext, input: unknown) => calendar.previewRestrictionUpdate(ports, tx, input),
    applyRestrictionUpdate: (tx: TxContext, input: unknown) => calendar.applyRestrictionUpdate(ports, tx, input),
    getRestrictions: calendar.getRestrictions,

    // ── Catalog ──
    createPolicy: (tx: TxContext, input: unknown) => catalog.createPolicy(ports, tx, input),
    updatePolicy: (tx: TxContext, id: string, expectedVersion: number, patch: { name?: string; structure?: unknown }) =>
      catalog.updatePolicy(ports, tx, id, expectedVersion, patch),
    getPolicy: (tx: TxContext, id: string) => catalog.getPolicy(ports, tx, id),
    listPolicies: (tx: TxContext, propertyId: string) => catalog.listPolicies(ports, tx, propertyId),
    policyVersionHistory: catalog.policyVersionHistory,
    createInclusion: (tx: TxContext, input: unknown) => catalog.createInclusion(ports, tx, input),
    updateInclusion: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updateInclusion(ports, tx, id, expectedVersion, patch),
    listInclusions: catalog.listInclusions,
    createPackage: (tx: TxContext, input: unknown) => catalog.createPackage(ports, tx, input),
    updatePackage: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updatePackage(ports, tx, id, expectedVersion, patch),
    listPackages: catalog.listPackages,
    createPromotion: (tx: TxContext, input: unknown) => catalog.createPromotion(ports, tx, input),
    updatePromotion: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updatePromotion(ports, tx, id, expectedVersion, patch),
    listPromotions: catalog.listPromotions,

    // ── Tax & fee rules ──
    listTaxRules: taxes.listTaxRules,
    getTaxRule: taxes.getTaxRule,
    createTaxRule: taxes.createTaxRule,
    addTaxRuleVersion: taxes.addTaxRuleVersion,
    previewTaxRuleActivation: taxes.previewTaxRuleActivation,
    activateTaxRuleVersion: taxes.activateTaxRuleVersion,
    withdrawTaxRuleVersion: taxes.withdrawTaxRuleVersion,
    installTaxTemplate: taxes.installTaxTemplate,
  };
}

export type RatesService = ReturnType<typeof ratesService>;
