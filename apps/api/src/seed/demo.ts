/**
 * Demo environment seeding (adoption brief §3 stage 1: "an immediately usable demonstration with realistic
 * sample properties and workflows"). Creates organizations in the `demo` environment only — demo
 * organizations can never charge cards, message guests, publish to channels or submit to governments
 * (packages/kernel/src/environment.ts).
 *
 * Modules contribute sample data through DEMO_SEED_STEPS (registered after each module merges).
 */
import { type PorticoDatabase, type TxContext, withTenantTx } from '@portico/db';
import { identity } from '@portico/identity';
import { fieldCryptoFromEnv, newId, type RequestContext, systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import { provisionOrganization } from '../provisioning';

export interface DemoProperty {
  id: string;
  code: string;
  profile: string;
  legalEntityId: string;
}

export interface DemoOrganization {
  tenantId: string;
  name: string;
  properties: DemoProperty[];
  users: Array<{ email: string; role: string; userId: string }>;
}

/** A module's contribution to demo data. Runs inside the demo organization's transaction. */
export interface DemoSeedStep {
  name: string;
  run(tx: TxContext, org: DemoOrganization): Promise<void>;
}

/**
 * Extra demo steps (tests/tools). Module demo data is registered in the composition root
 * (`Composition.demoSeedSteps`) because steps need the composed module services.
 */
export const DEMO_SEED_STEPS: DemoSeedStep[] = [];

/** Shared demo password — demo environment only; printed by the CLI; never valid in live organizations. */
export const DEMO_PASSWORD = 'portico-demo-2026';

/**
 * Shared demo authenticator secret (base32, RFC 6238) — ADR-0017 rule 16. Sensitive (⚑) permissions never take effect
 * without two-step verification, so the demo CLI enrols this fixed factor for every fictitious demo user and prints
 * it beside the password (add it to any authenticator app). Identity refuses it outside the `demo` environment and
 * for any real address. Published on purpose: it protects nothing but fictitious demo data.
 */
export const DEMO_TOTP_SECRET = 'PORTICODEMOAUTHENTICATORDEMOKEYS';

interface PropertySpec {
  code: string;
  name: string;
  profile: 'guesthouse' | 'boutique_hotel' | 'hotel' | 'resort' | 'serviced_apartments' | 'hostel';
  classification: Record<string, string | number | boolean>;
}

const ORGS: Array<{
  name: string;
  slug: string;
  planCode: string;
  legalEntity: { name: string; legalName: string };
  brand?: { code: string; name: string };
  properties: PropertySpec[];
  staff: Array<{ name: string; role: string; scope: 'organization' | 'property' }>;
}> = [
  {
    name: 'Coral Nest Guesthouse (demo)',
    slug: 'demo-coral-nest',
    planCode: 'essentials',
    legalEntity: { name: 'Coral Nest', legalName: 'Coral Nest Guest House Pvt Ltd (fictitious)' },
    properties: [
      {
        code: 'CNG',
        name: 'Coral Nest Guesthouse, Maafushi',
        profile: 'guesthouse',
        classification: {
          'mv.establishmentType': 'guesthouse',
          'mv.inhabitedIsland': true,
          'mv.registeredRooms': 12,
        },
      },
    ],
    staff: [
      { name: 'Owner (does everything)', role: 'org_admin', scope: 'organization' },
      { name: 'Reception', role: 'front_desk', scope: 'property' },
      { name: 'Housekeeping', role: 'housekeeping_attendant', scope: 'property' },
    ],
  },
  {
    name: 'Azure Atoll Collection (demo)',
    slug: 'demo-azure-atoll',
    planCode: 'enterprise',
    legalEntity: { name: 'Azure Atoll', legalName: 'Azure Atoll Hospitality Pvt Ltd (fictitious)' },
    brand: { code: 'AZURE', name: 'Azure Atoll' },
    properties: [
      {
        code: 'AZR',
        name: 'Azure Atoll Resort & Spa, Baa Atoll',
        profile: 'resort',
        classification: {
          'mv.establishmentType': 'resort',
          'mv.inhabitedIsland': false,
          'mv.registeredRooms': 120,
        },
      },
      {
        code: 'AZH',
        name: 'Azure Lagoon Hotel, Hulhumalé',
        profile: 'hotel',
        classification: {
          'mv.establishmentType': 'hotel',
          'mv.inhabitedIsland': true,
          'mv.registeredRooms': 64,
        },
      },
      {
        code: 'AZA',
        name: 'Azure Reef Residences, Malé',
        profile: 'serviced_apartments',
        classification: {
          'mv.establishmentType': 'hotel',
          'mv.inhabitedIsland': true,
          'mv.registeredRooms': 24,
        },
      },
    ],
    staff: [
      { name: 'Group Director', role: 'org_admin', scope: 'organization' },
      { name: 'Resort General Manager', role: 'general_manager', scope: 'property' },
      { name: 'Front Desk Agent', role: 'front_desk', scope: 'property' },
      { name: 'Reservations Agent', role: 'reservations_agent', scope: 'property' },
      { name: 'Night Auditor', role: 'night_auditor', scope: 'property' },
      { name: 'Housekeeping Supervisor', role: 'housekeeping_supervisor', scope: 'property' },
      { name: 'Room Attendant', role: 'housekeeping_attendant', scope: 'property' },
      { name: 'Chief Engineer', role: 'engineer', scope: 'property' },
      { name: 'Finance Manager', role: 'finance', scope: 'organization' },
      { name: 'Revenue Manager', role: 'revenue_manager', scope: 'organization' },
    ],
  },
];

const emailFor = (slug: string, staffName: string) =>
  `${staffName
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '')}@${slug}.demo.portico.invalid`;

export async function seedDemo(
  database: PorticoDatabase,
  opts: {
    businessDate: string;
    log?: (m: string) => void;
    steps?: DemoSeedStep[];
    /**
     * Enrol the fixed demo authenticator (DEMO_TOTP_SECRET) for every demo user (rule 16). The CLI turns it on, so
     * demo administrators keep their ⚑ permissions; sign-in then asks for the code after the password.
     */
    authenticator?: boolean;
  },
): Promise<DemoOrganization[]> {
  const steps = opts.steps ?? [
    ...(await import('../composition')).compose(database).demoSeedSteps,
    ...DEMO_SEED_STEPS,
  ];
  const log = opts.log ?? (() => {});
  // Same key source as the API (composition), so the API can read the factor the seed stores.
  const cipher = opts.authenticator ? fieldCryptoFromEnv().cipher : undefined;
  const result: DemoOrganization[] = [];
  for (const spec of ORGS) {
    const adminEmail = emailFor(spec.slug, spec.staff[0]?.name ?? 'admin');
    const { tenantId, adminUserId } = await provisionOrganization(
      database,
      {
        name: spec.name,
        slug: `${spec.slug}-${newId().slice(-6)}`,
        environment: 'demo',
        planCode: spec.planCode,
        admin: { email: adminEmail, displayName: spec.staff[0]?.name ?? 'Admin', password: DEMO_PASSWORD },
      },
      'demo-seeder',
    );
    const ctx: RequestContext = {
      tenantId,
      environment: 'demo',
      actor: { kind: 'system', process: 'demo-seeder' },
      authz: systemAuthorizer,
      correlationId: newId(),
    };
    const org = await withTenantTx(database, ctx, async (tx) => {
      const le = await platform.createLegalEntity(tx, {
        ...spec.legalEntity,
        countryCode: 'MV',
        baseCurrency: 'USD',
      });
      const brandId = spec.brand ? (await platform.createBrand(tx, spec.brand)).id : undefined;
      const properties: DemoProperty[] = [];
      for (const p of spec.properties) {
        const created = await platform.createProperty(tx, {
          code: p.code,
          name: p.name,
          profile: p.profile,
          legalEntityId: le.id,
          ...(brandId ? { brandId } : {}),
          countryCode: 'MV',
          timezone: 'Indian/Maldives',
          baseCurrency: 'USD',
          classification: p.classification,
          businessDate: opts.businessDate,
        });
        properties.push({
          id: created.id,
          code: created.code,
          profile: created.profile,
          legalEntityId: le.id,
        });
      }
      const users = [{ email: adminEmail, role: spec.staff[0]?.role ?? 'org_admin', userId: adminUserId }];
      for (const s of spec.staff.slice(1)) {
        const email = emailFor(spec.slug, s.name);
        // ADR-0017 rule 12: passwords are seeded only by this system process, in demo organizations, for
        // *.portico.invalid addresses (identity refuses anything else).
        const { userId } = await identity.seedDemoMember(tx, {
          email,
          displayName: s.name,
          password: DEMO_PASSWORD,
          roles:
            s.scope === 'organization'
              ? [{ roleKey: s.role, scopeType: 'organization' }]
              : properties.map((p) => ({ roleKey: s.role, scopeType: 'property' as const, scopeId: p.id })),
        });
        users.push({ email, role: s.role, userId });
      }
      if (cipher)
        for (const u of users)
          await identity.seedDemoTotp(tx, { cipher }, { userId: u.userId, secret: DEMO_TOTP_SECRET });
      const demoOrg: DemoOrganization = { tenantId, name: spec.name, properties, users };
      for (const step of steps) {
        log(`  ${spec.name}: ${step.name}`);
        await step.run(tx, demoOrg);
      }
      return demoOrg;
    });
    log(`seeded ${spec.name} (${org.properties.length} properties, ${org.users.length} users)`);
    result.push(org);
  }
  return result;
}
