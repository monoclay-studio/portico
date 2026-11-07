/**
 * Permission-aware profile search (GUE-R20): name (any script, typo-tolerant via pg_trgm), email, phone (any
 * format), company and identity document (last 4 or COUNTRY:NUMBER, permission-gated and audited). The
 * visibility predicate is part of the SQL, so a profile the user may not see is never returned — not even
 * counted.
 */
import { sql, type TxContext } from '@portico/db';
import { ForbiddenError } from '@portico/kernel';
import type { SearchQuery, SearchResult } from '../contracts';
import { normalizeEmail, normalizePhone } from '../domain/contact';
import { documentHashInput, documentLast4Input, normalizeDocumentNumber } from '../domain/documents';
import { autoTransliterate, detectScript, normalizeLatin, normalizeNative } from '../domain/names';
import { profileVisibility } from '../domain/visibility';
import type { GuestsPorts } from '../ports';
import { propertyCountry, requireSomeProfileRead, resolveAccess, visibilitySql } from './internal';

type Kind = Exclude<SearchQuery['kind'], 'auto'>;

export function detectQueryKind(q: string): Kind {
  if (q.includes('@')) return 'email';
  if (/^[A-Z]{2}:[A-Z0-9<\s-]{3,}$/i.test(q)) return 'document';
  // Booking confirmation codes: letters + separator + 6–10 Crockford characters, e.g. "AZR-7Q2X9K".
  if (/^[A-Z]{2,5}-[0-9A-Z]{4,10}$/i.test(q.trim())) return 'booking';
  const digits = q.replace(/\D/g, '');
  if (/^[+\d][\d\s().-]{5,}$/.test(q) && digits.length >= 6) return 'phone';
  // UX NAV-03: the desk searches by a phone fragment ("7712", "+960"): digits only, and either a leading "+" or at
  // least 4 digits — a 3-digit query ("214") is a room number or a name part, not a phone (review P3-6).
  if (
    /^\+?[\d\s().-]+$/.test(q.trim()) &&
    (q.trim().startsWith('+') ? digits.length >= 3 : digits.length >= 4)
  )
    return 'phone';
  return 'name';
}

interface Hit {
  id: string;
  matched_on: string;
  score: number;
}

export async function searchProfiles(
  tx: TxContext,
  ports: GuestsPorts,
  query: SearchQuery,
): Promise<SearchResult> {
  requireSomeProfileRead(tx);
  const access = await resolveAccess(tx, ports, { propertyId: query.propertyId ?? null });
  const kind = query.kind === 'auto' ? detectQueryKind(query.q) : query.kind;
  const visible = visibilitySql(access, 'p');
  const limit = query.limit;
  let hits: Hit[] = [];

  if (kind === 'email') {
    const email = normalizeEmail(query.q) ?? query.q.trim().toLowerCase();
    hits = (
      await sql<Hit>`
      select distinct p.id, 'email' as matched_on, 1.0::float8 as score
      from guests.profiles p join guests.contact_points c on c.profile_id = p.id
      where p.status = 'active' and c.kind = 'email' and c.normalized = ${email} and ${visible}
      limit ${limit}`.execute(tx.db)
    ).rows;
  } else if (kind === 'phone') {
    const country = await propertyCountry(tx, ports, query.propertyId ?? null);
    const n = normalizePhone(query.q, country);
    // Exact E.164 first; otherwise match the trailing national number (last 7–9 digits) so "8 916 123-45-67"
    // (Russian trunk prefix) or a number typed without its country code still finds the guest.
    const tail = n.digits.slice(-Math.min(9, n.digits.length));
    // A short fragment (3–6 digits, e.g. "7712" or the country code "+960") matches anywhere in the number, ranked
    // below exact and trailing-number matches (UX NAV-03).
    const fragment = query.q.replace(/\D/g, '');
    hits = (
      await sql<Hit>`
      select distinct p.id, 'phone' as matched_on,
             (case when c.normalized = ${n.e164} then 1.0
                   when length(${tail}) >= 7 and c.normalized like ${`%${tail}`} then 0.7 else 0.5 end)::float8 as score
      from guests.profiles p join guests.contact_points c on c.profile_id = p.id
      where p.status = 'active' and c.kind in ('phone', 'whatsapp')
        and (c.normalized = ${n.e164} or (length(${tail}) >= 7 and c.normalized like ${`%${tail}`})
             or (length(${fragment}) between 3 and 6 and c.normalized like ${`%${fragment}%`}))
        and ${visible}
      order by score desc limit ${limit}`.execute(tx.db)
    ).rows;
  } else if (kind === 'document') {
    // Identity-document search reveals that a document exists: permission-gated and audited.
    if (!tx.authz.can('guests.document.read')) throw new ForbiddenError('guests.document.read');
    const scope = tx.authz.propertyScope('guests.document.read');
    const raw = query.q.trim();
    const full = /^[A-Z]{2}:/i.test(raw);
    const hash = full
      ? ports.crypto.blindIndex(documentHashInput(raw.slice(3), raw.slice(0, 2)))
      : ports.crypto.blindIndex(documentLast4Input(normalizeDocumentNumber(raw)));
    const column = full ? sql.ref('d.number_hash') : sql.ref('d.last4_hash');
    const docScope = scope === 'all' ? sql`true` : sql`d.property_id = any(${[...scope]}::uuid[])`;
    hits = (
      await sql<Hit>`
      select distinct p.id, 'document' as matched_on, 1.0::float8 as score
      from guests.profiles p join guests.identity_documents d on d.profile_id = p.id
      where p.status = 'active' and ${column} = ${hash} and ${docScope} and ${visible}
      limit ${limit}`.execute(tx.db)
    ).rows;
    await tx.audit({
      action: 'guests.document.search',
      target: { type: 'guest_profile_search', id: 'document' },
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      metadata: { mode: full ? 'full_number' : 'last4', results: hits.length },
    });
  } else if (kind === 'booking') {
    // Booking code → profiles via the reservations index (port). Not connected → no results (never a guess).
    const ids = ports.bookingLookup
      ? await ports.bookingLookup.findProfileIdsByConfirmationCode(tx, query.q.trim().toUpperCase())
      : [];
    hits =
      ids.length === 0
        ? []
        : (
            await sql<Hit>`
      select p.id, 'booking' as matched_on, 1.0::float8 as score
      from guests.profiles p
      where p.status = 'active' and p.id = any(${ids}::uuid[]) and ${visible}
      limit ${limit}`.execute(tx.db)
          ).rows;
  } else if (kind === 'company') {
    if (!tx.authz.can('guests.company.read') && !tx.authz.can('guests.profile.read')) {
      throw new ForbiddenError('guests.company.read');
    }
    hits = await companyHits(tx, normalizeLatin(query.q), visible, limit);
  } else {
    // Names: native script (with automatic ICAO transliteration for Cyrillic), Latin with typo tolerance, and —
    // in auto mode — people linked to a matching company.
    const script = detectScript(query.q);
    const parts: Hit[][] = [];
    if (script && script !== 'Latn') {
      parts.push(await nativeHits(tx, normalizeNative(query.q), visible, limit));
      const latin = autoTransliterate(query.q);
      if (latin) parts.push(await latinHits(tx, normalizeLatin(latin), visible, limit, 'transliteration'));
    } else {
      const q = normalizeLatin(query.q);
      parts.push(await latinHits(tx, q, visible, limit, 'name'));
      if (query.kind === 'auto' && q.length >= 3) {
        parts.push((await companyHits(tx, q, visible, limit)).map((h) => ({ ...h, score: h.score * 0.8 })));
      }
    }
    const best = new Map<string, Hit>();
    for (const h of parts.flat()) {
      const prev = best.get(h.id);
      if (!prev || Number(h.score) > Number(prev.score)) best.set(h.id, h);
    }
    hits = [...best.values()].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, limit);
  }
  if (hits.length === 0) return { items: [] };
  const ids = hits.map((h) => h.id);
  const { rows } = await sql<{
    id: string;
    title: string | null;
    given_name: string | null;
    preferred_name: string | null;
    family_name: string;
    native_given_name: string | null;
    native_family_name: string | null;
    nationality: string | null;
    date_of_birth: string | null;
    vip_level: string | null;
    email: string | null;
    phone: string | null;
    links: string[];
    sharing: string[];
  }>`
    select p.id, p.title, p.given_name, p.preferred_name, p.family_name, p.native_given_name, p.native_family_name,
      p.nationality, p.date_of_birth::text as date_of_birth, p.vip_level,
      (select c.value from guests.contact_points c where c.profile_id = p.id and c.kind = 'email'
        order by c.is_primary desc, c.verified desc, c.created_at limit 1) as email,
      (select c.value from guests.contact_points c where c.profile_id = p.id and c.kind in ('phone', 'whatsapp')
        order by c.is_primary desc, c.verified desc, c.created_at limit 1) as phone,
      coalesce((select array_agg(pp.property_id::text) from guests.profile_properties pp where pp.profile_id = p.id), '{}') as links,
      coalesce((select array_agg(c.state) from guests.consents c where c.profile_id = p.id and c.purpose = 'cross_property_sharing'), '{}') as sharing
    from guests.profiles p where p.id = any(${ids}::uuid[])`.execute(tx.db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: SearchResult['items'] = [];
  for (const h of hits) {
    const r = byId.get(h.id);
    if (!r) continue;
    const consent = r.sharing.includes('withdrawn')
      ? 'withdrawn'
      : r.sharing.includes('granted')
        ? 'granted'
        : 'unknown';
    const view = profileVisibility(access, r.links, consent);
    if (view === 'none') continue; // defense in depth: SQL predicate already excluded these
    items.push({
      profileId: r.id,
      displayName: [r.title, r.preferred_name ?? r.given_name, r.family_name].filter(Boolean).join(' '),
      nativeName: [r.native_given_name, r.native_family_name].filter(Boolean).join(' ') || null,
      nationality: r.nationality,
      dateOfBirth: r.date_of_birth,
      vipLevel: r.vip_level,
      primaryEmail: r.email,
      primaryPhone: r.phone,
      visibility: view,
      matchedOn: h.matched_on,
      score: Math.round(Number(h.score) * 100) / 100,
    });
  }
  return { items };
}

type Visible = ReturnType<typeof visibilitySql>;

async function latinHits(
  tx: TxContext,
  q: string,
  visible: Visible,
  limit: number,
  matched: string,
): Promise<Hit[]> {
  if (!q) return [];
  const { rows } = await sql<Hit>`
    select p.id, ${matched} as matched_on,
           greatest(similarity(p.search_name, ${q}), word_similarity(${q}, p.search_name))::float8 as score
    from guests.profiles p
    where p.status = 'active' and (p.search_name % ${q} or ${q} <% p.search_name or p.search_name like ${`${q}%`})
      and ${visible}
    order by score desc, p.family_name limit ${limit}`.execute(tx.db);
  return rows;
}

async function nativeHits(tx: TxContext, q: string, visible: Visible, limit: number): Promise<Hit[]> {
  const compact = `%${q.replace(/\s+/g, '')}%`;
  const { rows } = await sql<Hit>`
    select p.id, 'native_name' as matched_on,
           greatest(similarity(p.search_name_native, ${q}),
                    case when replace(p.search_name_native, ' ', '') like ${compact} then 0.9 else 0 end)::float8 as score
    from guests.profiles p
    where p.status = 'active'
      and (p.search_name_native % ${q} or replace(p.search_name_native, ' ', '') like ${compact})
      and ${visible}
    order by score desc limit ${limit}`.execute(tx.db);
  return rows;
}

async function companyHits(tx: TxContext, q: string, visible: Visible, limit: number): Promise<Hit[]> {
  if (!q) return [];
  const { rows } = await sql<Hit>`
    select p.id, 'company' as matched_on, max(similarity(co.search_name, ${q}))::float8 as score
    from guests.profiles p
      join guests.company_contacts cc on cc.profile_id = p.id
      join guests.companies co on co.id = cc.company_id
    where p.status = 'active' and (co.search_name % ${q} or co.search_name like ${`%${q}%`}) and ${visible}
    group by p.id order by score desc limit ${limit}`.execute(tx.db);
  return rows.map((r) => ({ ...r, score: Math.max(Number(r.score), 0.5) }));
}
