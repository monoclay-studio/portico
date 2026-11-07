/**
 * S20 — A channel or payment integration goes unavailable during a busy shift.
 * Not yet possible with the merged modules: each todo names the exact missing capability (docs/scenarios/README.md).
 */
import { describe, it } from 'vitest';

describe('S20 — A channel or payment integration goes unavailable during a busy shift', () => {
  it.todo(
    'channel hub outage with stop-sell protection, queued ARI and recovery pull (distribution, wave 2) — the payments part (provider degraded, honest 503 with alternatives, no replays) is proven in modules/payments/test/scenario-s20-provider-outage.test.ts',
  );
  it.todo(
    'queued collections re-validated before running after recovery (payments collection plans not built)',
  );
});
