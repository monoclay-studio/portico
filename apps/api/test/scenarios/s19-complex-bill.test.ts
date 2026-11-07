/**
 * S19 — A guest's bill combines packages, allowances, different taxes and partial payments.
 * Not yet possible with the merged modules: each todo names the exact missing capability (docs/scenarios/README.md).
 */
import { describe, it } from 'vitest';

describe("S19 — A guest's bill combines packages, allowances, different taxes and partial payments", () => {
  it.todo(
    "Day Close posting nights with package components and allowance clearing (day-close, wave 2) — rates' package pricing part is proven in modules/rates/test/scenario-s19-package-bill-pricing.test.ts",
  );
  it.todo('outlet charges consuming the allowance and nightly breakage (resort POS intake, wave 2)');
  it.todo(
    'MVR cash partial payment at the business-date rate through the cashier (needs Day Close-posted bill to settle)',
  );
});
