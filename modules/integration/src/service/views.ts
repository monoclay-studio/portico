/**
 * Read models implementing the universal record contract (docs/architecture/domain-map.md §"Universal record
 * contract"): status per family, server-computed allowedActions (with plain-language reasons when disabled and
 * previewRequired for impactful actions), issues, owner and links.
 */
import { type Selectable, sql, type TxContext } from '@portico/db';
import { actorLabel, type RequestContext } from '@portico/kernel';
import type { Connection, ConnectionState, IntegrationException, Mapping, MappingKind } from '../contracts';
import { completedStep, isOperational, isSetupState, progress, SETUP_STEPS } from '../domain/setup-journey';
import { MAPPING_KIND_LABELS } from '../domain/vocabulary';
import { P } from '../manifest';
import type { ExceptionsTable, MappingsTable } from '../tables';
import {
  type ConnectionRow,
  canOnConnection,
  db,
  type IntegrationDeps,
  integrationStatusOf,
  iso,
  parseScope,
  provenanceOf,
  registered,
} from './common';

type Action = Connection['allowedActions'][number];

function can(
  tx: Pick<RequestContext, 'authz'>,
  conn: { property_ids: string[] },
  permission: string,
): boolean {
  if (conn.property_ids.length === 0) return tx.authz.propertyScope(permission) === 'all';
  return conn.property_ids.every((p) => tx.authz.can(permission, { propertyId: p }));
}

function action(
  key: string,
  label: string,
  enabled: boolean,
  reason: string | undefined,
  previewRequired = false,
): Action {
  return {
    action: key,
    label,
    enabled,
    ...(enabled || !reason ? {} : { reason }),
    ...(previewRequired ? { previewRequired } : {}),
  };
}

const NO_PERMISSION = 'You do not have permission for this; ask an integration administrator.';

async function connectionActions(
  tx: TxContext,
  deps: IntegrationDeps,
  row: ConnectionRow,
  ctx: { blockingIssues: number; hasCredential: boolean; governed: string[] },
): Promise<Action[]> {
  const def = registered(deps, row.connector_key).definition;
  const state = row.state as ConnectionState;
  const step = completedStep(state) ?? 0;
  const manage = can(tx, row, P.connectionManage);
  const creds = can(tx, row, P.credentialsManage);
  const activatePerm = can(tx, row, P.connectionActivate);
  const sync = can(tx, row, P.syncRunTrigger);
  const out: Action[] = [];
  if (state === 'disconnected') return out;
  const setupAction = (key: string, label: string, minStep: number, extraReason?: string) => {
    const inRange = isSetupState(state) && step >= minStep;
    const reason = !manage
      ? NO_PERMISSION
      : !inRange
        ? isSetupState(state)
          ? `Finish "${SETUP_STEPS[minStep - 1]?.title ?? 'the previous step'}" first.`
          : 'Setup is complete for this connection.'
        : extraReason;
    out.push(action(key, label, manage && inRange && !extraReason, reason));
  };
  if (isSetupState(state)) {
    setupAction('reviewCompatibility', 'Review compatibility', 1);
    if (def.credentialSchema) {
      out.push(
        action(
          'authorize',
          'Authorize access',
          creds && manage && step >= 2 && isSetupState(state),
          !creds || !manage ? NO_PERMISSION : 'Review compatibility first.',
        ),
      );
    } else {
      setupAction('authorize', 'Confirm access (no credentials needed)', 2);
    }
    setupAction('suggestMappings', 'Review suggested mappings', 3);
    setupAction(
      'resolveIssues',
      'Resolve flagged issues',
      4,
      ctx.blockingIssues > 0 ? `${ctx.blockingIssues} mapping issue(s) are still open.` : undefined,
    );
    setupAction('validate', 'Run validation', 5);
    setupAction('preview', 'Preview expected behavior', 6);
    out.push(
      action(
        'activate',
        'Activate approved scope',
        activatePerm && state === 'previewed',
        !activatePerm
          ? 'Activation needs the integration.connection.activate permission (a second person, if your organization separates duties).'
          : 'Preview the expected behavior first.',
        true,
      ),
    );
  }
  const operational = isOperational(state);
  if (operational || state === 'paused' || state === 'error') {
    if (def.fileBased) {
      out.push(action('importFile', 'Import a file', sync, NO_PERMISSION));
      out.push(
        action(
          'exportFile',
          'Generate an export file',
          sync && operational,
          sync ? 'Resume the connection first.' : NO_PERMISSION,
        ),
      );
    } else {
      out.push(
        action(
          'syncNow',
          'Retry now',
          sync && operational,
          !sync
            ? NO_PERMISSION
            : state === 'paused'
              ? 'The connection is paused.'
              : 'Rotate the credential first.',
        ),
      );
      out.push(
        action(
          'reconcile',
          'Reconcile now',
          sync && operational,
          !sync ? NO_PERMISSION : 'The connection must be active.',
        ),
      );
    }
    out.push(
      action(
        'pause',
        'Pause',
        manage && (operational || state === 'error'),
        !manage ? NO_PERMISSION : 'The connection is already paused.',
        true,
      ),
    );
    out.push(
      action(
        'resume',
        'Resume',
        manage && state === 'paused',
        !manage ? NO_PERMISSION : 'The connection is not paused.',
        true,
      ),
    );
    out.push(action('replace', 'Replace provider', manage, NO_PERMISSION, true));
  }
  if (def.credentialSchema && ctx.hasCredential) {
    out.push(action('rotateCredential', 'Rotate credential', creds, NO_PERMISSION, true));
  }
  out.push(
    action(
      'disconnect',
      'Disconnect',
      manage && ctx.governed.length === 0,
      !manage
        ? NO_PERMISSION
        : `${row.name} is the system of record for ${ctx.governed.join(', ')}. Move that responsibility first (replace the provider or change the system of record).`,
      true,
    ),
  );
  return out;
}

export async function connectionView(
  tx: TxContext,
  deps: IntegrationDeps,
  row: ConnectionRow,
): Promise<Connection> {
  const def = registered(deps, row.connector_key).definition;
  const steps = await db(tx)
    .selectFrom('integration.connection_steps')
    .select(['step', 'outcome', 'occurred_at', 'actor'])
    .where('connection_id', '=', row.id)
    .orderBy('seq')
    .execute();
  const cred = await db(tx)
    .selectFrom('integration.credentials')
    .select(['read_only_at_vendor'])
    .where('connection_id', '=', row.id)
    .where('status', '=', 'active')
    .executeTakeFirst();
  const state = row.state as ConnectionState;
  const resume = (row.resume_state as 'active' | 'monitoring' | null) ?? null;
  const prog = progress(
    state,
    resume,
    steps.map((s) => ({
      step: s.step,
      outcome: s.outcome,
      occurredAt: new Date(s.occurred_at).toISOString(),
      actorLabel: actorLabel(s.actor as RequestContext['actor']),
    })),
  );
  const mappingBlockers = isSetupState(state)
    ? await db(tx)
        .selectFrom('integration.mappings')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('connection_id', '=', row.id)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'unmapped'),
            eb.and([
              eb('status', '=', 'suggested'),
              eb('requires_review', '=', true),
              eb('reviewed', '=', false),
            ]),
          ]),
        )
        .executeTakeFirstOrThrow()
    : { n: 0 };
  const governed: string[] = [];
  if (state !== 'disconnected') {
    for (const propertyId of row.property_ids) {
      for (const g of def.governableDomains) {
        try {
          const a = await deps.ports.platform.getDataAuthority(tx, propertyId, g.domain);
          if (a.authority === 'external' && a.connectionId === row.id && !governed.includes(g.domain))
            governed.push(g.domain);
        } catch {
          // Authority is informational here; the action itself re-checks.
        }
      }
    }
  }
  const exceptions = await db(tx)
    .selectFrom('integration.exceptions')
    .select(['code', 'severity', 'problem', 'owner_user_id', 'owner_department_id', 'first_seen_at'])
    .where('connection_id', '=', row.id)
    .where('status', 'in', ['open', 'acknowledged'])
    .orderBy('severity', 'desc')
    .orderBy('last_seen_at', 'desc')
    .limit(5)
    .execute();
  const issues: Connection['issues'] = [];
  if (mappingBlockers.n > 0) {
    issues.push({
      code: 'mapping_issues',
      severity: 'blocking',
      message: `${mappingBlockers.n} mapping(s) need a decision before validation.`,
    });
  }
  if (row.health_status === 'down' || row.health_status === 'degraded') {
    issues.push({
      code: `health_${row.health_status}`,
      severity: row.health_status === 'down' ? 'blocking' : 'warning',
      message: row.health_reason ?? `Health is ${row.health_status}.`,
      ...(row.health_changed_at ? { since: new Date(row.health_changed_at).toISOString() } : {}),
    });
  }
  for (const e of exceptions) {
    issues.push({
      code: e.code,
      severity: e.severity === 'urgent' ? 'warning' : 'info',
      message: e.problem,
      since: new Date(e.first_seen_at).toISOString(),
      ...(e.owner_user_id
        ? { owner: { kind: 'user' as const, id: e.owner_user_id } }
        : e.owner_department_id
          ? { owner: { kind: 'department' as const, id: e.owner_department_id } }
          : {}),
    });
  }
  const trialWriteGuard =
    tx.environment === 'trial' && def.credentialSchema !== null && cred && cred.read_only_at_vendor !== true
      ? `This credential would allow changes in ${row.name} (${def.name}). Portico blocks all writes from trials.`
      : null;
  if (trialWriteGuard)
    issues.push({ code: 'trial_write_capable_credential', severity: 'info', message: trialWriteGuard });
  const integrationStatus = integrationStatusOf(def, state, tx);
  const links: Connection['links'] = row.property_ids.map((id) => ({
    rel: 'property',
    type: 'property',
    id,
  }));
  if (row.replaces_connection_id)
    links.push({ rel: 'replaces', type: 'integration_connection', id: row.replaces_connection_id });
  if (row.replaced_by_connection_id)
    links.push({ rel: 'replacedBy', type: 'integration_connection', id: row.replaced_by_connection_id });
  return {
    id: row.id,
    connectorKey: row.connector_key,
    connectorName: def.name,
    category: def.category,
    name: row.name,
    propertyIds: row.property_ids,
    state,
    resumeState: resume,
    setup: prog,
    scope: parseScope(row.scope),
    health: {
      status: row.health_status as Connection['health']['status'],
      reason: row.health_reason,
      changedAt: iso(row.health_changed_at),
    },
    integrationStatus,
    exchangeProvenance: provenanceOf(def, tx),
    fileBased: def.fileBased,
    interruptedSince: iso(row.interrupted_since),
    activatedAt: iso(row.activated_at),
    ownerUserId: row.owner_user_id,
    replacesConnectionId: row.replaces_connection_id,
    replacedByConnectionId: row.replaced_by_connection_id,
    trialWriteGuard,
    lastError: (row.last_error as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    version: row.version,
    status: { setup: state, health: row.health_status, integration: integrationStatus },
    allowedActions: await connectionActions(tx, deps, row, {
      blockingIssues: mappingBlockers.n,
      hasCredential: cred !== undefined,
      governed,
    }),
    issues,
    ...(row.owner_user_id ? { owner: { kind: 'user' as const, id: row.owner_user_id } } : {}),
    links,
  };
}

export function mappingView(
  r: Selectable<MappingsTable>,
  ctx: { tx: Pick<RequestContext, 'authz'>; conn: { property_ids: string[]; state: string } },
): Mapping {
  const review =
    can(ctx.tx, ctx.conn, P.mappingReview) &&
    (!r.financially_significant || can(ctx.tx, ctx.conn, P.mappingReviewFinancial));
  const closed = ctx.conn.state === 'disconnected';
  const why = closed
    ? 'The connection is disconnected.'
    : r.financially_significant
      ? 'Financially significant mappings need the integration.mapping.reviewFinancial permission.'
      : NO_PERMISSION;
  const kindLabel = MAPPING_KIND_LABELS[r.kind as MappingKind];
  const issues: Mapping['issues'] = [];
  if (r.status === 'unmapped') {
    issues.push({
      code: 'unmapped',
      severity: 'blocking',
      message: `Choose the Portico ${kindLabel} for "${r.external_label}" or mark it as not used.`,
    });
  }
  if (r.status === 'suggested' && r.requires_review && !r.reviewed) {
    issues.push({
      code: r.financially_significant ? 'financial_review_required' : 'review_required',
      severity: 'blocking',
      message: r.review_reason ?? 'Needs review.',
    });
  }
  const links: Mapping['links'] = [
    { rel: 'connection', type: 'integration_connection', id: r.connection_id },
  ];
  if (r.property_id) links.push({ rel: 'property', type: 'property', id: r.property_id });
  return {
    id: r.id,
    connectionId: r.connection_id,
    kind: r.kind as MappingKind,
    externalId: r.external_id,
    externalLabel: r.external_label,
    externalAttributes: (r.external_attrs as Record<string, unknown>) ?? {},
    propertyId: r.property_id,
    internalId: r.internal_id,
    internalLabel: r.internal_label,
    confidence: r.confidence === null ? null : Number(r.confidence),
    reasons: (r.reasons as Mapping['reasons']) ?? [],
    alternatives: (r.alternatives as Mapping['alternatives']) ?? [],
    financiallySignificant: r.financially_significant,
    requiresReview: r.requires_review,
    reviewReason: r.review_reason,
    reviewed: r.reviewed,
    reviewedBy: r.reviewed_by,
    reviewedAt: iso(r.reviewed_at),
    autoConfirmed: r.auto_confirmed,
    version: r.version,
    status: {
      mapping: r.status,
      review: r.requires_review ? (r.reviewed ? 'reviewed' : 'required') : 'not_required',
    },
    allowedActions: [
      action(
        'confirm',
        'Confirm',
        review && !closed && r.internal_id !== null && r.status !== 'confirmed',
        !review || closed
          ? why
          : r.internal_id === null
            ? 'There is no suggestion to confirm; choose a record.'
            : 'Already confirmed.',
      ),
      action('override', 'Choose another record', review && !closed, why),
      action(
        'ignore',
        'Mark as not used',
        review && !closed && r.status !== 'ignored',
        !review || closed ? why : 'Already marked as not used.',
      ),
      action(
        'reset',
        'Return to the suggestion',
        review && !closed && r.reviewed,
        !review || closed ? why : 'Nothing to reset.',
      ),
    ],
    issues,
    links,
  };
}

export function exceptionView(
  r: Selectable<ExceptionsTable>,
  ctx: { tx: Pick<RequestContext, 'authz'>; conn: { property_ids: string[] } },
): IntegrationException {
  const resolve = can(ctx.tx, ctx.conn, P.exceptionResolve);
  const open = r.status === 'open' || r.status === 'acknowledged';
  const technical = canOnConnection(ctx.tx, ctx.conn, P.technicalRead);
  const owner = r.owner_user_id
    ? { kind: 'user' as const, id: r.owner_user_id }
    : r.owner_department_id
      ? { kind: 'department' as const, id: r.owner_department_id }
      : undefined;
  const refs = (r.related_refs as Array<{ type: string; id: string }>) ?? [];
  return {
    id: r.id,
    connectionId: r.connection_id,
    propertyId: r.property_id,
    workflow: r.workflow,
    severity: r.severity,
    code: r.code,
    problem: r.problem,
    businessImpact: r.business_impact,
    responsibleParty: r.responsible_party,
    nextStep: r.next_step,
    relatedRefs: refs,
    ownerUserId: r.owner_user_id,
    ownerDepartmentId: r.owner_department_id,
    resolution: r.resolution,
    resolvedBy: r.resolved_by,
    resolvedAt: iso(r.resolved_at),
    occurrences: r.occurrences,
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    ...(technical ? { technicalDetail: (r.technical_detail as Record<string, unknown> | null) ?? null } : {}),
    version: r.version,
    status: { exception: r.status, severity: r.severity, responsibleParty: r.responsible_party },
    allowedActions: [
      action(
        'assign',
        'Assign owner',
        resolve && open,
        !resolve ? NO_PERMISSION : 'This exception is closed.',
      ),
      action('resolve', 'Resolve', resolve && open, !resolve ? NO_PERMISSION : 'This exception is closed.'),
      action(
        'ignore',
        'Ignore',
        resolve && open && r.severity === 'routine',
        !resolve
          ? NO_PERMISSION
          : !open
            ? 'This exception is closed.'
            : 'Urgent exceptions must be resolved, not ignored.',
      ),
    ],
    issues: [],
    ...(owner ? { owner } : {}),
    links: [
      { rel: 'connection', type: 'integration_connection', id: r.connection_id },
      ...(r.property_id ? [{ rel: 'property', type: 'property', id: r.property_id }] : []),
      ...refs.map((x) => ({ rel: 'related', type: x.type, id: x.id })),
    ],
  };
}
