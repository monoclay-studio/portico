/**
 * Rates' PORT surface (ADR-0015, integration-step review P2-6): what other modules bind. The calling module (e.g.
 * reservations creating a booking at a property) authorized the user's intent; rates does not re-check
 * `rates.quote.read` for quotes and price changes at that property (granted there only, kernel `delegateAtProperty`).
 * Kept explicit (ADR-0015 §5): complimentary / house-use terms and price overrides still need `rates.price.override`
 * (a free stay is a price decision the booking permission does not imply), and backdated quotes need
 * `rates.quote.backdate`. Sealed-terms verification, eligibility, restrictions and data authority are unchanged.
 * Rates' own HTTP routes keep every permission check (they call the service, not this surface).
 */
import type { TxContext } from '@portico/db';
import { delegateAtProperty } from '@portico/kernel';
import type { RatesService } from './service';

const QUOTE = ['rates.quote.read'] as const;

function propertyOf(input: unknown, path: 'propertyId' | 'terms'): string | null {
  const v = input as { propertyId?: unknown; terms?: { propertyId?: unknown } } | null;
  const p = path === 'propertyId' ? v?.propertyId : v?.terms?.propertyId;
  return typeof p === 'string' ? p : null;
}

export function ratesProvider(service: RatesService): RatesService {
  const at = (tx: TxContext, propertyId: string | null) =>
    propertyId ? delegateAtProperty(tx, QUOTE, propertyId) : tx;
  return {
    ...service,
    quote: (tx, request) => service.quote(at(tx, propertyOf(request, 'propertyId')), request),
    quoteDetailed: (tx, request) => service.quoteDetailed(at(tx, propertyOf(request, 'propertyId')), request),
    priceChange: (tx, input) => service.priceChange(at(tx, propertyOf(input, 'terms')), input),
  };
}
