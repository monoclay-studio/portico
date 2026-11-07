# ADR-0016: Finance decisions — billing-rule precedence, missing FX rates, deposit tax point

**Status:** Accepted · **Date:** 2026-11-07 · From the finance steward review (`docs/orchestration/reviews/review-finance.md`)
and the finance parity research.

1. **Billing-rule precedence = specificity, with nesting allowed.** A rule on a specific charge code beats a rule on
   its group; a date-bounded rule beats an open one; payer-specific beats general. Two rules of *equal* specificity
   that can match the same posting are rejected at save time. There is no user-ranked priority (patent caution,
   Q40). Posting must resolve against the posted code's full ancestry (fixes F-03). Spec FIN-R14 ("reject every
   overlap") is amended accordingly.
2. **Re-applying a stay's billing instructions is a merge, not a replace.** Re-application preserves cap usage and
   staff-created manual rules and shows a preview of what changes (fixes F-04).
3. **Missing exchange rate blocks.** A foreign-currency posting or invoice needs a rate for its business date (MMA
   source for MVR/USD). If none exists, the action is refused with a clear message; an authorized user may enter a
   manual rate with source and reason (audited). Never a silent fallback to an older rate.
4. **Deposit tax point: one model.** `rates` owns tax rules and the tax-point policy; `finance` owns what was declared.
   On receipt, finance calls `rates.computeTaxes` with `taxPointDate` = receipt date, records the tax declared on the
   deposit, and the final invoice credits that declared tax (no re-rating, no double taxation). Imported opening
   deposits carry the tax the previous system already declared (fixes F-09).
5. **Allowances on tax invoices (pending adviser, Q48).** Until the Maldives adviser confirms: the package price
   (including the allowance value) is invoiced once; consumption against an allowance is shown as information, not
   counted again in value-before-tax; breakage follows the package's tax already charged. Implemented as configurable
   rule-pack behaviour so the adviser's answer is a configuration change.
