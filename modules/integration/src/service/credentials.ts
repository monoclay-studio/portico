/**
 * Connection credentials. Values are validated with the connector's Zod schema, tested with a harmless vendor
 * call BEFORE anything is stored, and kept only in the SecretStore; the database holds a reference, the expiry,
 * the vendor-reported scopes and whether the credential is read-only at the vendor (G-03). Values never appear in
 * API responses, audit records, events or logs (INT-I06).
 */
import { type Selectable, sql, type TxContext } from '@portico/db';
import { newId, ValidationError } from '@portico/kernel';
import type { ConnectorDefinition, CredentialCheck } from '../connectors/sdk';
import type { CredentialView } from '../contracts';
import type { CredentialsTable } from '../tables';
import { actorKey, db, type IntegrationDeps, iso } from './common';

/** Validate the submitted credential against the connector schema; error messages name fields, never values. */
export function validateCredential(
  def: ConnectorDefinition,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!def.credentialSchema) return null;
  const parsed = def.credentialSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(credential)'))];
    throw new ValidationError(
      'invalid_credentials',
      `The credential for ${def.name} is incomplete or malformed (${fields.join(', ')}). Check the fields described in the connector and try again.`,
      { fields },
    );
  }
  return parsed.data;
}

export async function storeCredential(
  tx: TxContext,
  deps: IntegrationDeps,
  input: {
    connectionId: string;
    value: Record<string, unknown> | null;
    label: string;
    expiresAt: string | null | undefined;
    check: CredentialCheck;
  },
): Promise<Selectable<CredentialsTable>> {
  const previous = await db(tx)
    .selectFrom('integration.credentials')
    .selectAll()
    .where('connection_id', '=', input.connectionId)
    .where('status', '=', 'active')
    .forUpdate()
    .executeTakeFirst();
  if (previous) {
    await db(tx)
      .updateTable('integration.credentials')
      .set({ status: 'superseded', superseded_at: tx.now, secret_ref: null, version: sql`version + 1` })
      .where('id', '=', previous.id)
      .execute();
    if (previous.secret_ref) await deps.secrets.destroy(tx, previous.secret_ref);
  }
  const secretRef = input.value
    ? await deps.secrets.put(tx, { purpose: 'connection_credential', value: JSON.stringify(input.value) })
    : null;
  const candidates = [input.expiresAt, input.check.expiresAt]
    .filter((d): d is string => !!d)
    .map((d) => new Date(d));
  const expiresAt = candidates.length > 0 ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  return db(tx)
    .insertInto('integration.credentials')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      secret_ref: secretRef,
      store_kind: secretRef ? deps.secrets.kind : 'none',
      label: input.label,
      status: 'active',
      expires_at: expiresAt,
      verified_at: tx.now,
      account_label: input.check.accountLabel,
      scopes_granted: input.check.scopes,
      read_only_at_vendor: input.check.readOnly,
      rotated_from: previous?.id ?? null,
      created_at: tx.now,
      created_by: actorKey(tx),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface ActiveCredential {
  row: Selectable<CredentialsTable>;
  value: Record<string, unknown> | null;
}

export async function loadActiveCredential(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
): Promise<ActiveCredential | null> {
  const row = await db(tx)
    .selectFrom('integration.credentials')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!row) return null;
  const value = row.secret_ref
    ? (JSON.parse(await deps.secrets.get(tx, row.secret_ref)) as Record<string, unknown>)
    : null;
  return { row, value };
}

/** Revoke every credential of a connection and destroy the secrets (disconnect). */
export async function revokeCredentials(
  tx: TxContext,
  deps: IntegrationDeps,
  connectionId: string,
): Promise<number> {
  const rows = await db(tx)
    .selectFrom('integration.credentials')
    .select(['id', 'secret_ref'])
    .where('connection_id', '=', connectionId)
    .where('status', 'in', ['active', 'superseded'])
    .execute();
  for (const r of rows) {
    if (r.secret_ref) await deps.secrets.destroy(tx, r.secret_ref);
  }
  await db(tx)
    .updateTable('integration.credentials')
    .set({ status: 'revoked', secret_ref: null, superseded_at: tx.now, version: sql`version + 1` })
    .where('connection_id', '=', connectionId)
    .where('status', 'in', ['active', 'superseded'])
    .execute();
  return rows.length;
}

export async function listCredentials(tx: TxContext, connectionId: string): Promise<CredentialView[]> {
  const rows = await db(tx)
    .selectFrom('integration.credentials')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    accountLabel: r.account_label,
    scopesGranted: r.scopes_granted,
    readOnlyAtVendor: r.read_only_at_vendor,
    expiresAt: iso(r.expires_at),
    verifiedAt: iso(r.verified_at),
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    storeKind: r.store_kind,
  }));
}
