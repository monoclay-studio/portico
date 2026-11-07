/**
 * Development / e2e seed for the back office (idempotent):
 *  1. the foundation demo organizations (`pnpm --filter @portico/api seed:demo`), once;
 *  2. a TRAINING organization for the demo group director, so sign-in shows organization selection and
 *     "Practise in training" has somewhere to go.
 * Uses DATABASE_URL / APP_DATABASE_URL like the API. Never run against a live database.
 *
 * Demo users have two-step verification with the fixed demo authenticator (ADR-0017 rule 16). The training
 * organization is created the way a signed-in person asks for their own copy: the director signs in (password + demo
 * code) and joins the new organization as themselves (`addSelfToOrganization`). Nobody sets a password for anyone.
 */
import { execFileSync } from 'node:child_process';
import { createDatabase, withTenantTx } from '@portico/db';
import { identity } from '@portico/identity';
import {
  DomainError,
  fieldCryptoFromEnv,
  newId,
  type RequestContext,
  systemAuthorizer,
} from '@portico/kernel';
import { platform } from '@portico/platform';
import { answerWithDemoCode, DEMO_TOTP_SECRET } from '../e2e/demo-authenticator';

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
  execFileSync('pnpm', ['--filter', '@portico/api', 'seed:demo', businessDate], {
    stdio: 'inherit',
    env: process.env,
  });
  orgs = await orgsFor(GROUP_DIRECTOR);
}
if (!orgs) throw new Error('Demo seed did not create the group director');

/** The director signs in to the demo organization (password, then the demo authenticator code). */
async function signInDirector(organizationId: string): Promise<string> {
  const first = await identity.login(database, {
    email: GROUP_DIRECTOR,
    password: DEMO_PASSWORD,
    organizationId,
  });
  if (first.status === 'signed_in') return first.userId;
  if (first.status !== 'mfa_required') throw new Error(`Unexpected sign-in answer: ${first.status}`);
  // Same key source as the API, so the factor the demo seed stored can be read.
  const ports = { cipher: fieldCryptoFromEnv().cipher };
  let userId: string | null = null;
  await answerWithDemoCode(GROUP_DIRECTOR, async (code) => {
    try {
      userId = (
        await identity.completeMfaChallenge(database, ports, { challengeToken: first.challengeToken, code })
      ).userId;
      return 'ok';
    } catch (e) {
      if (e instanceof DomainError && e.details?.reason === 'invalid_code') return 'wrong_code';
      throw e;
    }
  });
  if (!userId) throw new Error('The director could not complete the sign-in code step');
  return userId;
}

if (!orgs.some((o) => o.environment === 'training')) {
  console.log('Creating the training organization…');
  const demoOrg = orgs.find((o) => o.environment === 'demo');
  if (!demoOrg) throw new Error('The group director has no demo organization');
  const directorId = await signInDirector(demoOrg.id);
  const tenantId = newId();
  const ctx: RequestContext = {
    tenantId,
    environment: 'training',
    actor: { kind: 'system', process: 'backoffice-seed' },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  await withTenantTx(database, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      id: tenantId,
      name: 'Azure Atoll Collection (training)',
      slug: `training-azure-atoll-${newId().slice(-6)}`,
      environment: 'training',
      planCode: 'enterprise',
    });
    await identity.seedSystemRoles(tx);
    // The signed-in director asked for this training copy: their request is their consent to join it.
    await identity.addSelfToOrganization(tx, {
      userId: directorId,
      displayName: 'Group Director',
      roleKey: 'org_admin',
    });
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
console.log(`Sign-in code: from the demo authenticator secret ${DEMO_TOTP_SECRET} (printed by seed:demo).`);
console.log('Other demo staff (same password): front.desk.agent@demo-azure-atoll.demo.portico.invalid, …');
await database.close();
