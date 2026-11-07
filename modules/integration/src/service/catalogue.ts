/** Integration catalogue: every connector with honest, workflow-level capability and readiness. */
import type { TxContext } from '@portico/db';
import { NotFoundError, requirePermission } from '@portico/kernel';
import { toSummary } from '../connectors/sdk';
import type { ConnectorCategory, ConnectorSummary } from '../contracts';
import { P } from '../manifest';
import type { IntegrationDeps } from './common';

export function listCatalogue(
  tx: TxContext,
  deps: IntegrationDeps,
  q: { category?: ConnectorCategory | undefined; connectable?: 'true' | 'false' | undefined },
): ConnectorSummary[] {
  requirePermission(tx, P.catalogueRead);
  return deps.connectors
    .list()
    .map(toSummary)
    .filter((c) => !q.category || c.category === q.category)
    .filter((c) => q.connectable === undefined || String(c.connectable) === q.connectable);
}

export function getCatalogueEntry(tx: TxContext, deps: IntegrationDeps, key: string): ConnectorSummary {
  requirePermission(tx, P.catalogueRead);
  const r = deps.connectors.get(key);
  if (!r) throw new NotFoundError('connector', key);
  return toSummary(r);
}
