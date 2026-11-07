import { createDatabase } from '@portico/db';
import { loadConfig } from '../config';
import { DEMO_PASSWORD, seedDemo } from './demo';

const config = loadConfig();
const database = createDatabase({
  connectionString: config.APP_DATABASE_URL,
  applicationName: 'portico-seed',
});
const businessDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const orgs = await seedDemo(database, { businessDate, log: (m) => console.log(m) });
console.log('\nDemo organizations (environment: demo — nothing real can happen here):');
for (const o of orgs) {
  console.log(`\n  ${o.name}`);
  for (const u of o.users) console.log(`    ${u.role.padEnd(24)} ${u.email}`);
}
console.log(`\n  Password for all demo users: ${DEMO_PASSWORD}`);
await database.close();
