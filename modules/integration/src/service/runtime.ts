/**
 * Preparing calls to connector adapters. Every call is prepared INSIDE a transaction (permission and
 * environment-safety checks, credential decryption) and executed OUTSIDE it, so no database transaction is held
 * open while a vendor answers (CLAUDE.md rule 5).
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, DomainError } from '@portico/kernel';
import {
  type AdapterContext,
  type ConnectorAdapter,
  ConnectorError,
  type RegisteredConnector,
} from '../connectors/sdk';
import type { ResponsibleParty } from '../contracts';
import { type ConnectionRow, db, gateEffect, type IntegrationDeps, registered } from './common';
import { type ActiveCredential, loadActiveCredential } from './credentials';

export interface PreparedCall {
  reg: RegisteredConnector;
  adapter: ConnectorAdapter;
  actx: AdapterContext;
  credential: ActiveCredential | null;
}

export async function prepareCall(
  tx: TxContext,
  deps: IntegrationDeps,
  conn: ConnectionRow,
  opts: { kind: 'read' | 'write'; workflow: string; credentialOverride?: Record<string, unknown> | null },
): Promise<PreparedCall> {
  const reg = registered(deps, conn.connector_key);
  if (!reg.adapter) {
    throw new BusinessRuleError(
      'connector_not_available',
      `${reg.definition.name} is listed in the catalogue but not built yet, so it cannot exchange information.`,
    );
  }
  const mode = await gateEffect(tx, deps, reg.definition, {
    workflow: opts.workflow,
    kind: opts.kind,
    connectionId: conn.id,
    propertyIds: conn.property_ids,
  });
  let credential: ActiveCredential | null = null;
  let value: Record<string, unknown> | null = null;
  if (opts.credentialOverride !== undefined) {
    value = opts.credentialOverride;
  } else {
    credential = await loadActiveCredential(tx, deps, conn.id);
    value = credential?.value ?? null;
    if (reg.definition.credentialSchema && !value) {
      throw new BusinessRuleError(
        'credential_missing',
        `There is no active credential for ${conn.name}. Authorize access (or rotate the credential) first.`,
      );
    }
  }
  let files: AdapterContext['files'];
  if (reg.definition.fileBased) {
    const rows = await db(tx)
      .selectFrom('integration.files')
      .select(['workflow', 'name', 'content', 'created_at'])
      .where('connection_id', '=', conn.id)
      .where('direction', '=', 'import')
      .orderBy('seq', 'desc')
      .limit(50)
      .execute();
    const latest = new Map<string, { workflow: string; name: string; content: string }>();
    for (const r of rows)
      if (!latest.has(r.workflow))
        latest.set(r.workflow, { workflow: r.workflow, name: r.name, content: r.content });
    files = [...latest.values()];
  }
  return {
    reg,
    adapter: reg.adapter,
    credential,
    actx: {
      tenantId: tx.tenantId,
      connectionId: conn.id,
      credential: value,
      mode,
      now: tx.now,
      ...(files ? { files } : {}),
    },
  };
}

/** Any adapter failure as a ConnectorError. Unknown failures during a send count as an unknown outcome. */
export function asConnectorError(err: unknown, phase: 'read' | 'send'): ConnectorError {
  if (err instanceof ConnectorError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ConnectorError(
    phase === 'send' ? 'timeout' : 'outage',
    `Unexpected connector failure: ${message}`,
  );
}

export function errorClassOf(
  kind: ConnectorError['kind'],
): 'transient' | 'permanent' | 'data' | 'auth' | 'rate_limited' {
  switch (kind) {
    case 'auth':
      return 'auth';
    case 'rate_limited':
      return 'rate_limited';
    case 'rejected':
      return 'permanent';
    case 'invalid':
      return 'data';
    default:
      return 'transient';
  }
}

export function responsibleFor(kind: ConnectorError['kind']): ResponsibleParty {
  if (kind === 'auth' || kind === 'invalid') return 'hotel';
  if (kind === 'outage' || kind === 'timeout' || kind === 'rate_limited' || kind === 'rejected')
    return 'vendor';
  return 'monoclay';
}

/** A connector failure as a staff-readable error: problem, impact, responsible party, next step (spec §10). */
export function explainConnectorError(systemName: string, err: ConnectorError, impact: string): DomainError {
  const party = responsibleFor(err.kind);
  const next =
    err.kind === 'auth'
      ? `Check the credential with the ${systemName} administrator and try again.`
      : err.kind === 'invalid'
        ? 'Correct the file or data described above and try again.'
        : `Try again in a few minutes. If it continues, check ${systemName}'s status page or support.`;
  return new DomainError('connector_failed', `${systemName}: ${err.message} ${next}`, {
    status: err.kind === 'invalid' ? 422 : 502,
    retryable: err.kind === 'outage' || err.kind === 'timeout' || err.kind === 'rate_limited',
    details: { kind: err.kind, impact, responsibleParty: party, nextStep: next },
  });
}
