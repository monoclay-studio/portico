import { createDatabase } from '@portico/db';
import { loadConfig } from '../config';
import { DEMO_PASSWORD, DEMO_TOTP_SECRET, seedDemo } from './demo';

const config = loadConfig();
const database = createDatabase({
  connectionString: config.APP_DATABASE_URL,
  applicationName: 'portico-seed',
});
const businessDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
// ADR-0017 rule 16: demo users get the fixed demo authenticator, so demo administrators keep their ⚑ permissions.
const orgs = await seedDemo(database, { businessDate, log: (m) => console.log(m), authenticator: true });
console.log('\nDemo organizations (environment: demo — nothing real can happen here):');
for (const o of orgs) {
  console.log(`\n  ${o.name}`);
  for (const u of o.users) console.log(`    ${u.role.padEnd(24)} ${u.email}`);
}
console.log(`\n  Password for all demo users:             ${DEMO_PASSWORD}`);
console.log(`  Authenticator secret for all demo users: ${DEMO_TOTP_SECRET}`);
console.log(
  '  Sign-in asks for a 6-digit code after the password: add the secret to any authenticator app\n' +
    '  (time-based, 30 seconds) or generate the code from it. Demo organizations only.',
);
await database.close();
