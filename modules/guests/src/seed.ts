/**
 * Demo seed (demo environment only): realistic multinational guests for Maldives source markets (China, Russia,
 * India, UK, Germany, Italy, US, GCC), a DMC / tour operator, a corporate account, a likely-duplicate pair for the
 * review queue and a same-name-different-person pair that must NOT be proposed. All people and companies are
 * fictitious; emails use the reserved `.example` domain and phones use fictional ranges where they exist.
 *
 * Compatible with apps/api DEMO_SEED_STEPS: `createGuestsDemoSeed(service)` → { name, run(tx, org) }.
 */
import type { TxContext } from '@portico/db';
import type { CreateProfileInput } from './contracts';
import type { GuestsService } from './service';

export interface DemoOrgLike {
  tenantId: string;
  properties: ReadonlyArray<{ id: string; code: string; legalEntityId: string }>;
}

type DemoGuest = Omit<CreateProfileInput, 'propertyId'> & {
  key: string;
  /** Index into org.properties of the properties the guest stayed at. */
  stays?: Array<{
    property: number;
    arrival: string;
    departure: string;
    status: string;
    revenueMinor?: number;
  }>;
  marketingEmail?: boolean;
  alert?: { severity: 'info' | 'important' | 'critical'; text: string };
  preference?: Array<{ category: string; value: string }>;
};

const GUESTS: DemoGuest[] = [
  {
    key: 'wang',
    nativeFamilyName: '王',
    nativeGivenName: '伟',
    familyName: 'Wang',
    givenName: 'Wei',
    language: 'zh-Hans',
    nationality: 'CN',
    dateOfBirth: '1991-04-18',
    importantDates: [{ kind: 'honeymoon', date: '2026-12-02', note: 'Honeymoon — arrival day' }],
    contactPoints: [
      { kind: 'email', value: 'wang.wei@guest.example', verified: true },
      { kind: 'phone', value: '+86 138 0013 8000' },
    ],
    preference: [{ category: 'pillow', value: 'Buckwheat pillow' }],
    stays: [
      {
        property: 0,
        arrival: '2025-12-02',
        departure: '2025-12-09',
        status: 'departed',
        revenueMinor: 1_260_000,
      },
    ],
  },
  {
    key: 'li',
    nativeFamilyName: '李',
    nativeGivenName: '娜',
    familyName: 'Li',
    givenName: 'Na',
    language: 'zh-Hans',
    nationality: 'CN',
    contactPoints: [{ kind: 'email', value: 'li.na@guest.example' }],
  },
  {
    key: 'petrov',
    nativeFamilyName: 'Петров',
    nativeGivenName: 'Иван',
    language: 'ru',
    nationality: 'RU',
    dateOfBirth: '1984-09-02',
    vipLevel: 'vip1',
    contactPoints: [{ kind: 'phone', value: '+7 916 123 45 67', verified: true }],
    preference: [{ category: 'diving', value: 'PADI Advanced — prefers early boat' }],
    stays: [
      {
        property: 0,
        arrival: '2025-02-10',
        departure: '2025-02-20',
        status: 'departed',
        revenueMinor: 2_150_000,
      },
      {
        property: 1,
        arrival: '2026-03-01',
        departure: '2026-03-03',
        status: 'departed',
        revenueMinor: 64_000,
      },
    ],
  },
  {
    key: 'smirnova',
    nativeFamilyName: 'Смирнова',
    nativeGivenName: 'Анна',
    language: 'ru',
    nationality: 'RU',
    contactPoints: [{ kind: 'email', value: 'anna.smirnova@guest.example' }],
    marketingEmail: true,
  },
  {
    key: 'sharma',
    familyName: 'Sharma',
    givenName: 'Priya',
    language: 'en-IN',
    nationality: 'IN',
    dateOfBirth: '1989-01-26',
    importantDates: [{ kind: 'anniversary', date: '2014-02-14' }],
    contactPoints: [{ kind: 'phone', value: '+91 98765 43210', verified: true }],
    preference: [{ category: 'dietary', value: 'Vegetarian (Jain) — no root vegetables' }],
  },
  {
    key: 'mehta',
    familyName: 'Mehta',
    givenName: 'Rahul',
    language: 'hi',
    nationality: 'IN',
    contactPoints: [{ kind: 'email', value: 'rahul.mehta@guest.example' }],
  },
  {
    key: 'clarke',
    title: 'Mrs',
    familyName: 'Clarke',
    givenName: 'Emily',
    language: 'en-GB',
    nationality: 'GB',
    dateOfBirth: '1976-06-15',
    vipLevel: 'vip2',
    contactPoints: [
      { kind: 'email', value: 'emily.clarke@guest.example', verified: true },
      { kind: 'phone', value: '+44 7700 900123' },
    ],
    marketingEmail: true,
    stays: [
      {
        property: 0,
        arrival: '2024-08-03',
        departure: '2024-08-17',
        status: 'departed',
        revenueMinor: 4_480_000,
      },
    ],
  },
  {
    key: 'muller',
    familyName: 'Müller',
    givenName: 'Lukas',
    language: 'de',
    nationality: 'DE',
    contactPoints: [{ kind: 'email', value: 'lukas.mueller@guest.example' }],
    preference: [{ category: 'villa', value: 'Sunset side, away from the jetty' }],
  },
  {
    key: 'rossi',
    familyName: 'Rossi',
    givenName: 'Giulia',
    language: 'it',
    nationality: 'IT',
    contactPoints: [{ kind: 'phone', value: '+39 06 1234 5678' }],
  },
  {
    key: 'johnson',
    familyName: 'Johnson',
    givenName: 'Michael',
    language: 'en-US',
    nationality: 'US',
    dateOfBirth: '1968-11-30',
    contactPoints: [{ kind: 'phone', value: '+1 202 555 0123', verified: true }],
    alert: {
      severity: 'critical',
      text: 'Severe shellfish allergy — inform all outlets (guest agreed to share)',
    },
  },
  {
    key: 'ali-ae',
    familyName: 'Ali',
    givenName: 'Ahmed',
    nativeFamilyName: 'علي',
    nativeGivenName: 'أحمد',
    language: 'ar',
    nationality: 'AE',
    dateOfBirth: '1980-03-01',
    contactPoints: [{ kind: 'email', value: 'ahmed.ali@guest.example', verified: true }],
  },
  {
    // Same name, different person (different DOB, nationality): must never be proposed as a duplicate.
    key: 'ali-sa',
    familyName: 'Ali',
    givenName: 'Ahmed',
    language: 'ar',
    nationality: 'SA',
    dateOfBirth: '1992-11-20',
    contactPoints: [{ kind: 'phone', value: '+966 50 123 4567' }],
  },
  {
    key: 'almansoori-1',
    familyName: 'Al Mansoori',
    givenName: 'Fatima',
    nationality: 'AE',
    dateOfBirth: '1987-07-07',
    contactPoints: [{ kind: 'email', value: 'fatima.m@guest.example' }],
  },
  {
    // Likely duplicate of the previous profile (hyphenation differs, same DOB and nationality).
    key: 'almansoori-2',
    familyName: 'Al-Mansoori',
    givenName: 'Fatima',
    nationality: 'AE',
    dateOfBirth: '1987-07-07',
    source: { kind: 'channel', ref: 'demo-ota' },
    contactPoints: [{ kind: 'email', value: 'fatima.98213@guest.booking.com' }],
  },
  {
    key: 'alkuwari',
    familyName: 'Al Kuwari',
    givenName: 'Noor',
    language: 'ar',
    nationality: 'QA',
    contactPoints: [{ kind: 'phone', value: '+974 5512 3456' }],
  },
];

/** Seed demo guests into an organization. Runs inside the caller's (demo) transaction with system authority. */
export async function seedDemoGuests(tx: TxContext, service: GuestsService, org: DemoOrgLike): Promise<void> {
  const props = org.properties;
  if (props.length === 0) return;
  const pick = (i: number) => props[i % props.length] as (typeof props)[number];
  const ids = new Map<string, string>();
  let n = 0;
  for (const g of GUESTS) {
    const { key, stays, marketingEmail, alert, preference, ...input } = g;
    const home = pick(stays?.[0]?.property ?? n++);
    const res = await service.resolveProfile(
      tx,
      { ...input, propertyId: home.id },
      { matchStrategy: 'create_new' },
    );
    ids.set(key, res.profileId);
    for (const [i, s] of (stays ?? []).entries()) {
      const p = pick(s.property);
      await service.recordStayHistory(tx, {
        profileId: res.profileId,
        stayRef: { type: 'stay', id: demoUuid(org.tenantId, `${key}:${i}`) },
        propertyId: p.id,
        arrival: s.arrival,
        departure: s.departure,
        status: s.status,
        ...(s.revenueMinor ? { revenue: { amountMinor: s.revenueMinor, currency: 'USD' } } : {}),
      });
    }
    for (const pref of preference ?? [])
      await service.addPreference(tx, res.profileId, { ...pref, propertyId: home.id });
    if (alert) {
      await service.addAlert(tx, res.profileId, {
        propertyId: home.id,
        severity: alert.severity,
        text: alert.text,
        visibility: 'shared',
        audience: ['front_office', 'fnb'],
      });
    }
    if (marketingEmail) {
      await service.recordConsent(tx, res.profileId, {
        legalEntityId: home.legalEntityId,
        purpose: 'marketing_email',
        state: 'granted',
        source: 'booking_engine',
        evidence: { textVersion: 'demo-marketing-v1', channel: 'booking_engine' },
      });
    }
  }
  const home = pick(0);
  const dmc = await service.createCompany(tx, {
    kind: 'agency',
    legalName: 'Lagoon Trails DMC Pvt Ltd (fictitious)',
    tradingName: 'Lagoon Trails',
    iataCode: '96200016',
    defaultMarketSegment: 'wholesale',
    commission: { model: 'percent_of_room', basisPoints: 1000, reference: 'Demo 2027 DMC contract' },
    billingEmail: 'accounts@lagoontrails.example',
    billingAddress: { line1: 'Orchid Magu', city: 'Malé', country: 'MV' },
  });
  const corp = await service.createCompany(tx, {
    kind: 'company',
    legalName: 'Meridian Offshore Energy Ltd (fictitious)',
    taxId: 'DEMO-GB-000123',
    defaultMarketSegment: 'corporate',
    billingEmail: 'travel.ap@meridian.example',
    billingAddress: { line1: '1 Example Wharf', city: 'Aberdeen', country: 'GB' },
  });
  const booker = await service.resolveProfile(
    tx,
    {
      propertyId: home.id,
      familyName: 'Fraser',
      givenName: 'Isla',
      nationality: 'GB',
      contactPoints: [{ kind: 'email', value: 'isla.fraser@meridian.example', verified: true }],
    },
    { matchStrategy: 'create_new' },
  );
  await service.addCompanyContact(tx, corp.id, { profileId: booker.profileId, role: 'booker' });
  await service.addCompanyContact(tx, corp.id, { profileId: booker.profileId, role: 'travel_manager' });
  const clarke = ids.get('clarke');
  if (clarke) await service.addCompanyContact(tx, corp.id, { profileId: clarke, role: 'primary' });
  const wang = ids.get('wang');
  if (wang) await service.addCompanyContact(tx, dmc.id, { profileId: wang, role: 'other' });
}

export function createGuestsDemoSeed(service: GuestsService) {
  return {
    name: 'guests: multinational demo guests, a DMC and a corporate account',
    run: (tx: TxContext, org: DemoOrgLike) => seedDemoGuests(tx, service, org),
  };
}

/** Deterministic UUID-shaped id for demo stay references (no real stay exists until reservations seeds). */
function demoUuid(tenantId: string, key: string): string {
  let h = 0x811c9dc5;
  const s = `${tenantId}:${key}`;
  const out: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + round;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push(h.toString(16).padStart(8, '0'));
  }
  const hex = out.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
