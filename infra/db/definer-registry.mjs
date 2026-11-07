/**
 * The ONE list of reviewed SECURITY DEFINER functions (no dependencies, so tests and tools can import it).
 * Used by bootstrap-roles.mjs (grants phase: grant/revoke, fail closed on anything else) and mirrored into
 * infra/restore-drill/verify.sql check 7 — infra/db/definer-lists.test.mjs fails when the two differ and prints the
 * SQL to paste (`node infra/db/definer-lists.test.mjs --print`).
 */

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
    // identity maintenance jobs (IDENTITY_JOBS, ssoDomainRecheckJob)
    'identity.purge_login_attempts(integer, integer)',
    'identity.purge_orphan_sso_links()',
    'identity.sso_domains_due(timestamp with time zone)',
  ],
  workerAndApp: ['payments.route_webhook(text, text, boolean)'],
};

/**
 * Reviewed SECURITY DEFINER functions the API itself must call: sign-in before a tenant exists, tenant lookups, and
 * identity's cross-organization safety checks (ADR-0017: memberships elsewhere, verified-domain ownership, credential
 * epochs, platform alerts, the simulated-message mailbox). Each returns or changes only what its caller is entitled
 * to; reviewed in the identity steward reviews. The worker inherits these through portico_app.
 */
export const APP_DEFINER_FUNCTIONS = [
  'identity.login_lookup(text)',
  'identity.record_login_result(uuid, boolean)',
  'identity.ensure_user(uuid, text)',
  'identity.record_login_attempt(text, text, boolean, integer)',
  'identity.credential_epoch_for_email(text)',
  'identity.credential_summary(uuid)',
  'identity.first_email_verification(uuid, timestamp with time zone)',
  'identity.lock_person(uuid)',
  'identity.memberships_elsewhere(uuid, uuid)',
  'identity.pending_invitations(uuid)',
  'identity.revoke_sessions_everywhere(uuid, text)',
  'identity.claim_verified_domain(text, uuid, timestamp with time zone)',
  'identity.release_verified_domain(text, uuid)',
  'identity.verified_domain_holder(text)',
  'identity.record_domain_check(uuid, text, boolean, timestamp with time zone)', // also the re-check job
  'identity.raise_platform_alert(uuid, text, text, jsonb, text)',
  'identity.list_platform_alerts(integer)',
  'identity.deposit_simulated_message(uuid, uuid, text, text, text, text, text)',
  'identity.read_dev_mailbox(text, integer)',
  'platform.tenant_environment(uuid)',
  'platform.tenant_summaries(uuid[])',
];

/** Postgres's canonical regprocedure text: no space after commas. */
export const canonical = (signature) => signature.replace(/,\s+/g, ',');
