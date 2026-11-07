#!/usr/bin/env node
/**
 * Portico database role bootstrap (production-shaped environments: demo, staging, production). Two phases:
 *
 *   node bootstrap-roles.mjs          ROLES. As the RDS MASTER user (RDS-managed secret), as a one-off ECS task,
 *                                     BEFORE the first migration and after every credential rotation. Makes the
 *                                     database roles match the secrets in Secrets Manager (below).
 *   node bootstrap-roles.mjs grants   ROUTING GRANTS. As portico_owner (DATABASE_URL, the migration task with a
 *                                     command override), AFTER every migration run. Grants the reviewed
 *                                     cross-tenant routing functions to portico_worker and revokes the job-only
 *                                     ones from portico_app, then verifies the result (exits non-zero otherwise).
 *
 * Roles:
 *
 *   portico_owner        LOGIN. Owns every schema/table/function. Used ONLY by the migration task.
 *                        Not superuser, no CREATEROLE, no CREATEDB, no BYPASSRLS.
 *   portico_app          NOLOGIN group role. Every migration grants table/function privileges to it.
 *                        Created here so the migration runner's `create role if not exists` is a no-op.
 *   portico_app_blue     LOGIN members of portico_app (inherit its privileges; RLS applies to them).
 *   portico_app_green    Two login roles allow zero-downtime "alternating user" password rotation:
 *                        the running tasks keep using the old role until replaced.
 *   portico_worker       NOLOGIN group role, member of portico_app (same table privileges, same RLS), PLUS the
 *                        SECURITY DEFINER routing functions that return cross-tenant routing metadata (which tenant
 *                        has due jobs, outbox claims). Request handlers (portico_app) cannot call the job-only ones.
 *   portico_worker_blue  LOGIN members of portico_worker, used by apps/worker; alternating rotation as above.
 *   portico_worker_green
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
 *   WORKER_SECRET_JSON              same shape for portico_worker_blue / portico_worker_green
 *   DATABASE_URL                    grants phase only: the portico_owner connection (migration task secret)
 *   PGSSLMODE                       verify-full in AWS (CA via NODE_EXTRA_CA_CERTS); 'disable' only for local tests
 *   ENABLE_IAM_READONLY_ROLE        'true' to create portico_ops_readonly with rds_iam (requires IAM DB auth)
 *   APP_CONNECTION_LIMIT            Optional per-login-role connection limit (default -1 = unlimited)
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';

const OWNER = 'portico_owner';
const APP_GROUP = 'portico_app';
const APP_LOGINS = ['portico_app_blue', 'portico_app_green'];
const WORKER_GROUP = 'portico_worker';
const WORKER_LOGINS = ['portico_worker_blue', 'portico_worker_green'];

/**
 * Reviewed SECURITY DEFINER functions that return cross-tenant ROUTING metadata (tenant ids, never business data).
 * `workerOnly`: called only from apps/worker (outbox dispatcher, `runDueJobs` jobs) — revoked from portico_app.
 * `workerAndApp`: also called from a public API route before any tenant context exists. Granted to portico_worker
 *   and kept on portico_app until the API serves that route through a worker-role pool (payments
 *   FOUNDATION_REQUESTS §4; cell variable `api_holds_worker_credentials`), then moved to `workerOnly`.
 * Signatures must match the migrations exactly. A function that does not exist yet is skipped and reported; a NEW
 * SECURITY DEFINER function executable by portico_app that is in neither list is reported as unreviewed.
 */
export const ROUTING_FUNCTIONS = {
  workerOnly: [
    // packages/db core dispatcher + scheduler
    'core.claim_unfanned_events(integer)',
    'core.record_fanout(uuid, text[])',
    'core.claim_deliveries(integer, integer)',
    'core.record_delivery_failure(uuid, text, text, integer)',
    'core.claim_job(text, integer, integer)',
    'core.finish_job(text, boolean, text)',
    'core.purge_expired_idempotency_keys(integer)',
    // module job routing
    'payments.tenants_for_jobs()',
    'integration.claim_due_tenants(integer, integer)',
    'inventory.tenants_with_due_expiries(timestamp with time zone, integer)',
    'inventory.tenants_with_ledger_since(date, integer)',
    'operations.job_properties()',
    'guests.tenants_with_expired_documents(date)',
    'guests.tenants_with_active_profiles()',
    'reservations.due_booking_expiries(timestamp with time zone)',
  ],
  workerAndApp: ['payments.route_webhook(text, text, boolean)'],
};

/** Reviewed SECURITY DEFINER functions the API itself must call (sign-in before a tenant exists, tenant lookups). */
export const APP_DEFINER_FUNCTIONS = [
  'identity.login_lookup(text)',
  'identity.record_login_result(uuid, boolean)',
  'identity.ensure_user(uuid, text)',
  'platform.tenant_environment(uuid)',
  'platform.tenant_summaries(uuid[])',
];
const IAM_READONLY = 'portico_ops_readonly';
const TRUSTED_EXTENSIONS = ['btree_gist', 'pg_trgm'];

/** One JSON line per event on stdout (CloudWatch Logs friendly). */
function logInfo(msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'info', msg, ...extra })}\n`);
}

function required(name) {
  const v = process.env[name];
  if (!v)
    throw new Error(`Missing required environment variable ${name}. See the header of bootstrap-roles.mjs.`);
  return v;
}

function parseSecret(name) {
  try {
    return JSON.parse(required(name));
  } catch (err) {
    throw new Error(
      `${name} is not valid JSON (${err.message}). Expected the full Secrets Manager secret string.`,
    );
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
    throw new Error(
      `Password for ${role} is missing or shorter than 32 characters. Rotate the secret first.`,
    );
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
  const worker = parseSecret('WORKER_SECRET_JSON');
  if (owner.username !== OWNER) throw new Error(`OWNER_SECRET_JSON.username must be ${OWNER}`);
  const loginPasswords = (secret, name, logins) => {
    const map = new Map([
      [secret.username, secret.password],
      [secret.standby_username, secret.standby_password],
    ]);
    for (const r of logins) {
      if (!map.has(r)) throw new Error(`${name} must define both ${logins.join(' and ')}`);
      assertPassword(r, map.get(r));
    }
    return map;
  };
  const appPasswords = loginPasswords(app, 'APP_SECRET_JSON', APP_LOGINS);
  const workerPasswords = loginPasswords(worker, 'WORKER_SECRET_JSON', WORKER_LOGINS);
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
  const log = logInfo;
  try {
    await client.query(`select pg_advisory_lock(hashtext('portico_role_bootstrap'))`);
    await client.query('begin');

    // 1. Owner (migration) role.
    log('role', { role: OWNER, result: await ensureLoginRole(client, OWNER, owner.password, 'noinherit') });

    // 2. Application group role (no login) + two login members for alternating rotation.
    if (!(await roleExists(client, APP_GROUP))) {
      await client.query(
        `create role ${APP_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
      log('role', { role: APP_GROUP, result: 'created' });
    } else {
      await client.query(
        `alter role ${APP_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
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
      await client.query(
        `alter role ${client.escapeIdentifier(r)} set idle_in_transaction_session_timeout = '60s'`,
      );
      log('role', { role: r, result, memberOf: APP_GROUP });
    }

    // 2b. Worker group role: everything portico_app has (membership), plus the routing grants of the grants phase.
    if (!(await roleExists(client, WORKER_GROUP))) {
      await client.query(
        `create role ${WORKER_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
      log('role', { role: WORKER_GROUP, result: 'created' });
    } else {
      await client.query(
        `alter role ${WORKER_GROUP} with nologin nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
    }
    await client.query(`grant ${APP_GROUP} to ${WORKER_GROUP}`);
    for (const r of WORKER_LOGINS) {
      const result = await ensureLoginRole(
        client,
        r,
        workerPasswords.get(r),
        `inherit connection limit ${Number.isFinite(connectionLimit) ? connectionLimit : -1}`,
      );
      await client.query(`grant ${WORKER_GROUP} to ${client.escapeIdentifier(r)}`);
      // Jobs scan more than a request does; still bounded so a stuck statement cannot hold locks forever.
      await client.query(`alter role ${client.escapeIdentifier(r)} set statement_timeout = '300s'`);
      await client.query(
        `alter role ${client.escapeIdentifier(r)} set idle_in_transaction_session_timeout = '60s'`,
      );
      log('role', { role: r, result, memberOf: WORKER_GROUP });
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
        await client.query(
          `create role ${IAM_READONLY} with login nosuperuser nocreatedb nocreaterole nobypassrls`,
        );
      }
      if (await roleExists(client, 'rds_iam')) await client.query(`grant rds_iam to ${IAM_READONLY}`);
      if (await roleExists(client, 'pg_read_all_data'))
        await client.query(`grant pg_read_all_data to ${IAM_READONLY}`);
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
    const bad = rows.filter(
      (r) => r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.privileged_member,
    );
    if (bad.length > 0) {
      throw new Error(`Privileged Portico roles found, refusing to continue: ${JSON.stringify(bad)}`);
    }
    await client.query('commit');
    log('bootstrap complete', {
      roles: rows.map((r) => r.rolname).sort(),
      activeAppRole: app.username,
      activeWorkerRole: worker.username,
    });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('portico_role_bootstrap'))`).catch(() => {});
    await client.end();
  }
}

/**
 * Grants phase (after migrations, as the owner of the functions). Idempotent; re-run after every migration because a
 * migration may re-grant a function to portico_app or recreate it. Returns the verification report and throws when
 * the database does not match ROUTING_FUNCTIONS afterwards.
 */
export async function applyRoutingGrants(client, log = () => {}) {
  if (!(await roleExists(client, WORKER_GROUP))) {
    throw new Error(`${WORKER_GROUP} does not exist: run the roles phase (node bootstrap-roles.mjs) first.`);
  }
  const resolve = async (signature) => {
    const { rows } = await client.query('select to_regprocedure($1)::text as fn', [signature]);
    return rows[0]?.fn ?? null;
  };
  const report = { granted: [], revokedFromApp: [], missing: [], unreviewed: [] };
  await client.query('begin');
  try {
    for (const [list, revoke] of [
      [ROUTING_FUNCTIONS.workerOnly, true],
      [ROUTING_FUNCTIONS.workerAndApp, false],
    ]) {
      for (const signature of list) {
        const fn = await resolve(signature);
        if (!fn) {
          report.missing.push(signature);
          continue;
        }
        await client.query(`grant execute on function ${fn} to ${WORKER_GROUP}`);
        report.granted.push(fn);
        if (revoke) {
          await client.query(`revoke execute on function ${fn} from ${APP_GROUP}, public`);
          report.revokedFromApp.push(fn);
        }
      }
    }
    // Verify with the server's own privilege check (membership and PUBLIC included).
    const check = async (role, fn) => {
      const { rows } = await client.query(`select has_function_privilege($1, $2, 'execute') as ok`, [
        role,
        fn,
      ]);
      return rows[0].ok === true;
    };
    const problems = [];
    for (const fn of report.granted) {
      if (!(await check(WORKER_GROUP, fn))) problems.push(`${WORKER_GROUP} cannot execute ${fn}`);
    }
    for (const fn of report.revokedFromApp) {
      if (await check(APP_GROUP, fn)) problems.push(`${APP_GROUP} can still execute worker-only ${fn}`);
    }
    for (const login of APP_LOGINS) {
      if (!(await roleExists(client, login))) continue;
      for (const fn of report.revokedFromApp) {
        if (await check(login, fn)) problems.push(`${login} can still execute worker-only ${fn}`);
      }
    }
    // Any other SECURITY DEFINER function in a Portico schema that request handlers can call must be reviewed.
    const known = new Set();
    for (const sig of [
      ...ROUTING_FUNCTIONS.workerOnly,
      ...ROUTING_FUNCTIONS.workerAndApp,
      ...APP_DEFINER_FUNCTIONS,
    ]) {
      const fn = await resolve(sig);
      if (fn) known.add(fn);
    }
    const { rows: definers } = await client.query(
      `select p.oid::regprocedure::text as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and p.prorettype <> 'trigger'::regtype -- trigger functions cannot be called directly
          and n.nspname not in ('pg_catalog', 'information_schema', 'public')
          and n.nspname not like 'pg_%'
          and has_function_privilege($1, p.oid, 'execute')
        order by 1`,
      [APP_GROUP],
    );
    report.unreviewed = definers.map((r) => r.fn).filter((fn) => !known.has(fn));
    if (problems.length > 0) throw new Error(`Routing grants verification failed: ${problems.join('; ')}`);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
  log('routing grants applied', report);
  if (report.unreviewed.length > 0) {
    // Not fatal (a module may legitimately add one), but it must be reviewed and listed above: a cross-tenant
    // SECURITY DEFINER function callable from request handlers is exactly what payments review P3-5 flagged.
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'unreviewed SECURITY DEFINER functions executable by portico_app',
        functions: report.unreviewed,
        action:
          'review each one and add it to ROUTING_FUNCTIONS or APP_DEFINER_FUNCTIONS in infra/db/bootstrap-roles.mjs',
      }),
    );
  }
  return report;
}

async function grants() {
  const client = new pg.Client({
    connectionString: required('DATABASE_URL'),
    application_name: 'portico-db-grants',
  });
  await client.connect();
  try {
    const { rows } = await client.query('select current_user as u');
    if (rows[0].u !== OWNER && process.env.PORTICO_ALLOW_NON_OWNER_GRANTS !== 'true') {
      throw new Error(
        `The grants phase must run as ${OWNER} (the owner of the functions), not ${rows[0].u}.`,
      );
    }
    await client.query(`select pg_advisory_lock(hashtext('portico_role_bootstrap'))`);
    await applyRoutingGrants(client, logInfo);
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('portico_role_bootstrap'))`).catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = process.argv[2] ?? 'roles';
  const run = phase === 'grants' ? grants : phase === 'roles' ? main : null;
  if (!run) {
    console.error(
      JSON.stringify({ level: 'error', msg: `unknown phase "${phase}" (expected: roles | grants)` }),
    );
    process.exit(2);
  }
  run().catch((err) => {
    console.error(
      JSON.stringify({ level: 'error', msg: 'role bootstrap failed', err: String(err?.message ?? err) }),
    );
    process.exit(1);
  });
}
