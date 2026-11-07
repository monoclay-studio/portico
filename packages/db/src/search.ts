import type { RecordSummary, SearchHit } from '@portico/kernel';
import type { TxContext } from './tx';

/**
 * A module's contribution to global search and hover previews. Providers MUST enforce permissions and property
 * scope themselves (use tx.authz.propertyScope) — global search only aggregates.
 */
export interface SearchProvider {
  /** Record types this provider can return and summarize. */
  types: readonly string[];
  search(tx: TxContext, query: string, opts: { limit: number }): Promise<SearchHit[]>;
  summarize?(tx: TxContext, type: string, id: string): Promise<RecordSummary | null>;
}

/** Normalise a free-text query for matching (trim, collapse whitespace, cap length). */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').slice(0, 200);
}
