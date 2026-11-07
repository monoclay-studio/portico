/**
 * S02 — An OTA reservation is delivered twice, then modified and cancelled.
 * Not yet possible with the merged modules: each todo names the exact missing capability (docs/scenarios/README.md).
 */
import { describe, it } from 'vitest';

describe('S02 — An OTA reservation is delivered twice, then modified and cancelled', () => {
  it.todo(
    'channel ingestion from a connected channel: the distribution module (channel connection, mapping, ack after commit) is wave 2',
  );
  it.todo(
    "agreed terms from the channel's delivered prices: rates does not build priceSource 'channel' terms yet (termsFromChannelPrices; the bound adapter answers 503 channel_terms_not_available)",
  );
  it.todo(
    'VCC charge of the cancellation penalty through a collection plan (payments collection plans PAY-R20 not built)',
  );
});
