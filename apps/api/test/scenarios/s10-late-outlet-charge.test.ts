/**
 * S10 — A restaurant charge arrives after the guest has checked out.
 * Not yet possible with the merged modules: each todo names the exact missing capability (docs/scenarios/README.md).
 */
import { describe, it } from 'vitest';

describe('S10 — A restaurant charge arrives after the guest has checked out', () => {
  it.todo(
    'POS intake of an outlet check for a departed stay (resort module, wave 2) — the finance part (late charge after departure → collection request to payments) is proven in apps/api/test/bindings.test.ts',
  );
  it.todo(
    'merchant-initiated charge on the card on file when the agreed terms allow it (payments collects late charges by payment request only; MIT from agreed terms not built)',
  );
  it.todo(
    'supplementary folio after an issued invoice and its supplementary invoice (finance gap: one open supplementary folio per original)',
  );
});
