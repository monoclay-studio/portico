/**
 * Global search + hover previews for guests and companies (`GET /v1/search`, `/v1/records/:type/:id/summary`).
 * Guest search is the most-used search in the product: names in any script (with transliteration), email, phone
 * in any format, company, and — with guests.document.read only — identity document. Permission-, property- and
 * cross-property-sharing-aware: it never returns or previews a record the user may not see.
 */
import { normalizeQuery, type SearchProvider, type TxContext } from '@portico/db';
import { DomainError, type RecordSummary, type SearchHit } from '@portico/kernel';
import type { GuestsService } from './service';

const quiet = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    // Permission / visibility refusals simply mean "no results" in global search.
    if (err instanceof DomainError && (err.status === 403 || err.status === 404)) return fallback;
    throw err;
  }
};

export function guestsSearchProvider(service: GuestsService): SearchProvider {
  const readsProfiles = (tx: TxContext) =>
    tx.authz.can('guests.profile.read') || tx.authz.can('guests.profile.readShared');
  const readsCompanies = (tx: TxContext) =>
    tx.authz.can('guests.company.read') || tx.authz.can('guests.profile.read');
  return {
    types: ['guest_profile', 'company'],
    async search(tx, query, { limit }): Promise<SearchHit[]> {
      const q = normalizeQuery(query);
      if (q.length < 2) return [];
      const hits: SearchHit[] = [];
      if (readsProfiles(tx)) {
        const res = await quiet(() => service.searchProfiles(tx, { q, kind: 'auto', limit }), { items: [] });
        for (const i of res.items) {
          hits.push({
            type: 'guest_profile',
            id: i.profileId,
            title: i.displayName,
            subtitle: [
              i.nativeName,
              i.nationality,
              i.primaryEmail ?? i.primaryPhone,
              i.vipLevel?.toUpperCase(),
            ]
              .filter(Boolean)
              .join(' · '),
            status: { profile: 'active' },
            propertyId: null,
            score: Math.max(0.3, Math.min(1, i.score)),
            matched: i.matchedOn,
          });
        }
      }
      if (readsCompanies(tx) && !q.includes('@')) {
        const companies = await quiet(() => service.listCompanies(tx, { q, limit }), []);
        for (const c of companies) {
          hits.push({
            type: 'company',
            id: c.id,
            title: c.tradingName ? `${c.tradingName} (${c.legalName})` : c.legalName,
            subtitle: [
              c.kind === 'agency' ? 'Travel agent' : 'Company',
              c.iataCode ? `IATA ${c.iataCode}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            status: { company: c.status.company },
            propertyId: null,
            score: c.iataCode === q || c.taxId?.toUpperCase() === q.toUpperCase() ? 1 : 0.6,
            matched: c.iataCode === q ? 'iata' : 'name',
          });
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async summarize(tx, type, id): Promise<RecordSummary | null> {
      if (type === 'guest_profile') {
        const p = await quiet(() => service.getProfile(tx, id), null);
        if (!p) return null;
        return {
          type,
          id: p.id,
          title: p.displayName,
          subtitle: [
            [p.nativeGivenName, p.nativeFamilyName].filter(Boolean).join(' ') || null,
            p.nationality,
            p.vipLevel?.toUpperCase(),
            p.alerts.some((a) => a.status === 'active' && a.severity === 'critical')
              ? 'Critical alert'
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          status: p.status,
          propertyId: null,
        };
      }
      if (type === 'company') {
        const c = await quiet(() => service.getCompany(tx, id), null);
        if (!c) return null;
        return {
          type,
          id: c.id,
          title: c.legalName,
          subtitle: c.kind === 'agency' ? 'Travel agent' : 'Company',
          status: c.status,
          propertyId: null,
        };
      }
      return null;
    },
  };
}
