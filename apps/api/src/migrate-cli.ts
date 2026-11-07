import { migrate, sourcesFromManifests } from '@portico/db';
import pg from 'pg';
import { MANIFESTS } from './composition';
import { loadConfig } from './config';

const config = loadConfig();
const url = new URL(config.DATABASE_URL);
const dbName = url.pathname.slice(1);
// Development convenience: create the database if it does not exist.
if (config.NODE_ENV !== 'production') {
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(config.DATABASE_URL), { pathname: '/postgres' }).toString(),
  });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  await admin.end();
}
const devPassword =
  config.NODE_ENV !== 'production'
    ? (config.APP_DB_DEV_PASSWORD ?? new URL(config.APP_DATABASE_URL).password)
    : undefined;
const { applied } = await migrate({
  connectionString: config.DATABASE_URL,
  sources: sourcesFromManifests(MANIFESTS),
  ...(devPassword ? { appRolePassword: decodeURIComponent(devPassword) } : {}),
  log: (m) => console.log(m),
});
console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
