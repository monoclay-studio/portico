/**
 * Development / e2e seed for the back office (idempotent):
 *  1. the foundation demo organizations (`pnpm --filter @portico/api seed:demo`), once;
 *  2. a TRAINING organization for the demo group director, so sign-in shows organization selection and
 *     "Practise in training" has somewhere to go.
 * Uses DATABASE_URL / APP_DATABASE_URL like the API. Never run against a live database.
 */
import { execFileSync } from 'node:child_process';
import { provisionOrganization } from '@portico/api';
import { createDatabase, withTenantTx } from '@portico/db';
import { identity } from '@portico/identity';
import { newId, type RequestContext, systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';

export const DEMO_PASSWORD = 'portico-demo-2026'; // printed by seed:demo; demo environment only
export const GROUP_DIRECTOR = 'group.director@demo-azure-atoll.demo.portico.invalid';
const businessDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const appUrl = process.env.APP_DATABASE_URL;
if (!appUrl || !process.env.DATABASE_URL) throw new Error('Set DATABASE_URL and APP_DATABASE_URL');
if (/prod|live/i.test(appUrl)) throw new Error('Refusing to seed a database that looks like production');

const database = createDatabase({ connectionString: appUrl, applicationName: 'backoffice-seed' });

async function orgsFor(email: string) {
  try {
    const r = await identity.login(database, { email, password: DEMO_PASSWORD });
    return r.status === 'select_organization' ? r.organizations : [r.organization];
  } catch {
    return null;
  }
}

let orgs = await orgsFor(GROUP_DIRECTOR);
if (!orgs) {
  console.log('Seeding demo organizations…');
  execFileSync('pnpm', ['--filter', '@portico/api', 'seed:demo', businessDate], { stdio: 'inherit', env: process.env });
  orgs = await orgsFor(GROUP_DIRECTOR);
}
if (!orgs) throw new Error('Demo seed did not create the group director');

if (!orgs.some((o) => o.environment === 'training')) {
  console.log('Creating the training organization…');
  const { tenantId } = await provisionOrganization(
    database,
    {
      name: 'Azure Atoll Collection (training)',
      slug: `training-azure-atoll-${newId().slice(-6)}`,
      environment: 'training',
      planCode: 'enterprise',
      admin: { email: GROUP_DIRECTOR, displayName: 'Group Director' },
    },
    'backoffice-seed',
  );
  const ctx: RequestContext = {
    tenantId,
    environment: 'training',
    actor: { kind: 'system', process: 'backoffice-seed' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  await withTenantTx(database, ctx, async (tx) => {
    const le = await platform.createLegalEntity(tx, {
      name: 'Azure Atoll (training)',
      legalName: 'Azure Atoll Hospitality Pvt Ltd (fictitious, training)',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    await platform.createProperty(tx, {
      code: 'AZR-T',
      name: 'Azure Atoll Resort & Spa (training copy)',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      classification: { 'mv.establishmentType': 'resort', 'mv.inhabitedIsland': false, 'mv.roomCount': 120 },
      businessDate,
    });
  });
}

console.log(`\nBack office seed ready. Sign in as ${GROUP_DIRECTOR} / ${DEMO_PASSWORD}`);
console.log('Other demo staff (same password): front.desk.agent@demo-azure-atoll.demo.portico.invalid, …');
await database.close();
