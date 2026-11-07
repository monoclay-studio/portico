#!/usr/bin/env node
/**
 * Portico database role bootstrap (production-shaped environments: demo, staging, production).
 *
 * Runs as the Aurora MASTER user (RDS-managed secret) as a one-off ECS task, BEFORE the first migration and
 * after every credential rotation. It makes the database roles match the secrets in Secrets Manager:
 *
 *   portico_owner        LOGIN. Owns every schema/table/function. Used ONLY by the migration task.
 *                        Not superuser, no CREATEROLE, no CREATEDB, no BYPASSRLS.
 *   portico_app          NOLOGIN group role. Every migration grants table/function privileges to it.
 *                        Created here so the migration runner's `create role if not exists` is a no-op.
 *   portico_app_blue     LOGIN members of portico_app (inherit its privileges; RLS applies to them).
 *   portico_app_green    Two login roles allow zero-downtime "alternating user" password rotation:
 *                        the running tasks keep using the old role until replaced.
 *   portico_ops_readonly Optional (IAM auth only, no password). For human, audited, read-only investigation.
 *
 * Idempotent. Passwords are sent as SCRAM-SHA-256 verifiers computed here, so the plaintext never appears in
 * Postgres logs even with log_statement = 'ddl'. Finishes with an assertion that no Portico role is a superuser,
 * can bypass RLS, or is a member of rds_superuser — the process exits non-zero otherwise.
 *
 * Environment (injected by the ECS task definition from Secrets Manager — never put values in code):
 *   PGHOST, PGPORT, PGDATABASE      Target cluster writer endpoint and application database
 *   MASTER_USERNAME, MASTER_PASSWORD  Keys of the RDS-managed master secret
 *   OWNER_SECRET_JSON               {"username":"portico_owner","password":"…",…}
 *   APP_SECRET_JSON                 {"username":"portico_app_blue","password":"…",
 *                                    "standby_username":"portico_app_green","standby_password":"…",…}
 *   PGSSLMODE                       verify-full in AWS (CA via NODE_EXTRA_CA_CERTS); 'disable' only for local tests
 *   ENABLE_IAM_READONLY_ROLE        'true' to create portico_ops_readonly with rds_iam (requires IAM DB auth)
 *   APP_CONNECTION_LIMIT            Optional per-login-role connection limit (default -1 = unlimited)
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

const OWNER = 'portico_owner';
const APP_GROUP = 'portico_app';
const APP_LOGINS = ['portico_app_blue', 'portico_app_green'];
const IAM_READONLY = 'portico_ops_readonly';
const TRUSTED_EXTENSIONS = ['btree_gist', 'pg_trgm'];

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. See the header of bootstrap-roles.mjs.`);
  return v;
}

function parseSecret(name) {
  try {
    return JSON.parse(required(name));
  } catch (err) {
    throw new Error(`${name} is not valid JSON (${err.message}). Expected the full Secrets Manager secret string.`);
  }
}

/** RFC 5802 / RFC 7677 SCRAM-SHA-256 verifier in the format Postgres stores in pg_authid. */
export function scramVerifier(password, iterations = 4096, salt = randomBytes(16)) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

function assertPassword(role, pw) {
  if (typeof pw !== 'string' || pw.length < 32) {
    throw new Error(`Password for ${role} is missing or shorter than 32 characters. Rotate the secret first.`);
  }
}

async function roleExists(client, role) {
  const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [role]);
  return rowCount === 1;
}

async function ensureLoginRole(client, role, password, extra) {
  const ident = client.escapeIdentifier(role);
  const verifier = client.escapeLiteral(scramVerifier(password));
  const attrs = `login nosuperuser nocreatedb nocreaterole noreplication nobypassrls ${extra}`;
  if (await roleExists(client, role)) {
    await client.query(`alter role ${ident} with ${attrs} password ${verifier}`);
    return 'updated';
  }
  await client.query(`create role ${ident} with ${attrs} password ${verifier}`);
  return 'created';
}

async function main() {
  const database = required('PGDATABASE');
  const owner = parseSecret('OWNER_SECRET_JSON');
  const app = parseSecret('APP_SECRET_JSON');
  if (owner.username !== OWNER) throw new Error(`OWNER_SECRET_JSON.username must be ${OWNER}`);
  const appPasswords = new Map([
    [app.username, app.password],
    [app.standby_username, app.standby_password],
  ]);
  for (const r of APP_LOGINS) {
    if (!appPasswords.has(r)) throw new Error(`APP_SECRET_JSON must define both ${APP_LOGINS.join(' and ')}`);
    assertPassword(r, appPasswords.get(r));
  }
  assertPassword(OWNER, owner.password);
  const connectionLimit = Number.parseInt(process.env.APP_CONNECTION_LIMIT ?? '-1', 10);

  const sslmode = process.env.PGSSLMODE ?? 'verify-full';
  const client = new pg.Client({
    host: required('PGHOST'),
    port: Number.parseInt(process.env.PGPORT ?? '5432', 10),
    database,
    user: required('MASTER_USERNAME'),
    password: required('MASTER_PASSWORD'),
    application_name: 'portico-db-bootstrap',
    ssl: sslmode === 'disable' ? false : { rejectUnauthorized: true },
  });
  await client.connect();
  const log = (msg, extra = {}) => console.log(JSON.stringify({ level: 'info', msg, ...extra }));
  try {
    await client.query(`select pg_advisory_lock(hashtext('portico_role_bootstrap'))`);
    await client.query('begin');

    // 1. Owner (migration) role.
    log('role', { role: OWNER, result: await ensureLoginRole(client, OWNER, owner.password, 'noinherit') });

    // 2. Application group role (no login) + two login members for alternating rotation.
    if (!(await roleExists(client, APP_GROUP))) {
      await client.query(`create role ${APP_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`);
      log('role', { role: APP_GROUP, result: 'created' });
    } else {
      await client.query(`alter role ${APP_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`);
    }
    for (const r of APP_LOGINS) {
      const result = await ensureLoginRole(
        client,
        r,
        appPasswords.get(r),
        `inherit connection limit ${Number.isFinite(connectionLimit) ? connectionLimit : -1}`,
      );
      await client.query(`grant ${APP_GROUP} to ${client.escapeIdentifier(r)}`);
      // Defense in depth on top of the app's own statement_timeout.
      await client.query(`alter role ${client.escapeIdentifier(r)} set statement_timeout = '60s'`);
      await client.query(`alter role ${client.escapeIdentifier(r)} set idle_in_transaction_session_timeout = '60s'`);
      log('role', { role: r, result, memberOf: APP_GROUP });
    }

    // 3. Database-level privileges. Nobody but the owner may create objects.
    const db = client.escapeIdentifier(database);
    await client.query(`revoke all on database ${db} from public`);
    await client.query(`grant connect, create, temporary on database ${db} to ${OWNER}`);
    await client.query(`grant connect, temporary on database ${db} to ${APP_GROUP}`);
    await client.query('revoke create on schema public from public');

    // 4. Trusted extensions the core migration needs. Created by the master so the owner needs no extra rights.
    for (const ext of TRUSTED_EXTENSIONS) {
      await client.query(`create extension if not exists ${client.escapeIdentifier(ext)}`);
    }

    // 5. Optional IAM-authenticated read-only operator role (no password; RLS still applies to it).
    if (process.env.ENABLE_IAM_READONLY_ROLE === 'true') {
      if (!(await roleExists(client, IAM_READONLY))) {
        await client.query(`create role ${IAM_READONLY} with login nosuperuser nocreatedb nocreaterole nobypassrls`);
      }
      if (await roleExists(client, 'rds_iam')) await client.query(`grant rds_iam to ${IAM_READONLY}`);
      if (await roleExists(client, 'pg_read_all_data')) await client.query(`grant pg_read_all_data to ${IAM_READONLY}`);
      await client.query(`grant connect on database ${db} to ${IAM_READONLY}`);
      await client.query(`alter role ${IAM_READONLY} set default_transaction_read_only = on`);
      log('role', { role: IAM_READONLY, result: 'ensured' });
    }

    // 6. Hard assertion: no Portico role is privileged. Fail the task (and the deploy) otherwise.
    const { rows } = await client.query(
      `select r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                       where m.member = r.oid and g.rolname in ('rds_superuser', 'pg_write_all_data')) as privileged_member
         from pg_roles r where r.rolname like 'portico\\_%'`,
    );
    const bad = rows.filter((r) => r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.privileged_member);
    if (bad.length > 0) {
      throw new Error(`Privileged Portico roles found, refusing to continue: ${JSON.stringify(bad)}`);
    }
    await client.query('commit');
    log('bootstrap complete', { roles: rows.map((r) => r.rolname).sort(), activeAppRole: app.username });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('portico_role_bootstrap'))`).catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'role bootstrap failed', err: String(err?.message ?? err) }));
    process.exit(1);
  });
}
