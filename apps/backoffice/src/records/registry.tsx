/**
 * Record type registry: how each record type is loaded into the universal record anatomy, summarised for hover
 * previews and opened as a full page. Real types (property, legal entity, staff member) come from the API on
 * main; operational types (stay, unit, guest) come from the simulated workspace source until their modules
 * merge — their models carry `provenance: simulated`.
 */
import {
  formatLocalDate,
  formatMoney,
  formatTime,
  type HistoryState,
  type RecordAction,
  type RecordModel,
  type RecordSummary,
} from '@portico/ui';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { api, isApiError } from '../api';
import { queries } from '../api/queries';
import type { AppContextValue } from '../app/app-context';
import { propertyContext } from '../data/property';
import { bindWorkspaceSources } from '../data/sources';
import { Facts } from '../features/common/page-header';
import { ReadinessChecks } from '../features/front-desk/readiness';

export interface RecordCtx {
  app: AppContextValue;
  t: TFunction;
  lng: string;
  queryClient: QueryClient;
}

export interface LoadedRecord {
  model: RecordModel;
  /** 'server' = fetch GET /v1/records/:type/:id/history. */
  history: HistoryState | 'server';
}

export interface ActionHandlers {
  navigate: (to: string, search?: Record<string, string>) => void;
  toast: (t: { tone: 'success' | 'info' | 'pending' | 'error'; title: string; description?: string }) => void;
  openExtend: (stayId: string) => void;
  openRecord: (type: string, id: string) => void;
}

export interface RecordDefinition {
  type: string;
  simulated: boolean;
  load(ctx: RecordCtx, id: string): Promise<LoadedRecord | null>;
  summary(ctx: RecordCtx, id: string): Promise<RecordSummary | null>;
  fullPage?: (id: string) => string;
  onAction?: (ctx: RecordCtx, model: RecordModel, action: RecordAction, h: ActionHandlers) => void;
}

const disabled = (action: string, label: string, reason: string): RecordAction => ({
  action,
  label,
  enabled: false,
  reason,
});

const property: RecordDefinition = {
  type: 'property',
  simulated: false,
  async load(ctx, id) {
    const { property: p, version } = await ctx.queryClient.fetchQuery(queries.property(ctx.app.session, id));
    const entities = await ctx.queryClient.fetchQuery(queries.legalEntities(ctx.app.session)).catch(() => []);
    const le = entities.find((e) => e.id === p.legalEntityId);
    const t = ctx.t;
    const current = ctx.app.property?.id === p.id;
    return {
      history: 'server',
      model: {
        type: 'property',
        id: p.id,
        typeLabel: t('records.types.property'),
        title: p.name,
        code: p.code,
        subtitle: `${t(`profiles.${p.profile}`)} · ${p.timezone} · ${p.baseCurrency}`,
        status: [{ family: t('admin.propertyStatus'), value: p.status }],
        provenance: { kind: 'live' },
        actions: [
          { action: 'edit', label: t('records.actions.editSettings'), enabled: true },
          current
            ? disabled('switch', t('records.actions.switchProperty'), t('records.reasons.alreadyCurrent'))
            : { action: 'switch', label: t('records.actions.switchProperty'), enabled: true },
        ],
        issues:
          p.status === 'setup' ? [{ code: 'setup', severity: 'info', message: t('admin.setupIssue') }] : [],
        owner: { kind: 'department', id: 'org-admins', name: t('admin.ownerAdmins') },
        sections: [
          {
            id: 'details',
            title: t('records.sections.details'),
            helpKey: 'settings.properties.details',
            content: (
              <Facts
                items={[
                  [
                    t('admin.code'),
                    <span key="c" className="pt-code">
                      {p.code}
                    </span>,
                  ],
                  [t('admin.profile'), t(`profiles.${p.profile}`)],
                  [t('admin.timezone'), p.timezone],
                  [t('admin.currency'), p.baseCurrency],
                  [
                    t('app.businessDate'),
                    <span key="bd" className="pt-code">
                      {p.businessDate}
                    </span>,
                  ],
                  [t('admin.checkInTime'), p.checkInTime],
                  [t('admin.checkOutTime'), p.checkOutTime],
                  [
                    t('common.versionLabel'),
                    <span key="v" className="pt-code">
                      {version}
                    </span>,
                  ],
                ]}
              />
            ),
          },
          {
            id: 'classification',
            title: t('records.sections.classification'),
            collapsed: true,
            content: (
              <Facts
                items={Object.entries(p.classification).map(([k, v]) => [
                  <span key={k} className="pt-code">
                    {k}
                  </span>,
                  String(v),
                ])}
              />
            ),
          },
        ],
        links: le
          ? [{ rel: t('records.types.legal_entity'), type: 'legal_entity', id: le.id, title: le.name }]
          : [],
        helpKey: 'settings.properties.record',
      },
    };
  },
  async summary(_ctx, id) {
    const r = await api.recordSummary('property', id);
    return r.data;
  },
  fullPage: (id) => `/settings/properties/${id}`,
  onAction(ctx, model, action, h) {
    if (action.action === 'edit') h.navigate(`/settings/properties/${model.id}`);
    if (action.action === 'switch') {
      ctx.app.setPropertyId(model.id);
      h.toast({ tone: 'success', title: ctx.t('admin.switched', { name: model.title }) });
    }
  },
};

const legalEntity: RecordDefinition = {
  type: 'legal_entity',
  simulated: false,
  async load(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.legalEntities(ctx.app.session));
    const le = list.find((e) => e.id === id);
    if (!le) return null;
    const t = ctx.t;
    const props = ctx.app.properties.filter((p) => p.legalEntityId === id);
    return {
      history: 'server',
      model: {
        type: 'legal_entity',
        id,
        typeLabel: t('records.types.legal_entity'),
        title: le.name,
        subtitle: le.legalName,
        status: [{ family: t('admin.country'), value: le.countryCode }],
        provenance: { kind: 'live' },
        actions: [
          disabled(
            'edit',
            t('records.actions.edit'),
            t('records.reasons.apiMissing', { what: 'PATCH /v1/legal-entities/:id' }),
          ),
        ],
        issues: le.taxId
          ? []
          : [{ code: 'tax_id_missing', severity: 'warning', message: t('admin.taxIdMissing') }],
        sections: [
          {
            id: 'details',
            title: t('records.sections.details'),
            content: (
              <Facts
                items={[
                  [t('admin.legalName'), le.legalName],
                  [t('admin.registrationNumber'), le.registrationNumber ?? '—'],
                  [t('admin.taxId'), le.taxId ?? '—'],
                  [t('admin.baseCurrency'), le.baseCurrency],
                ]}
              />
            ),
          },
        ],
        links: props.map((p) => ({
          rel: t('records.types.property'),
          type: 'property',
          id: p.id,
          title: p.name,
        })),
        helpKey: 'settings.legalEntities.record',
      },
    };
  },
  async summary(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.legalEntities(ctx.app.session));
    const le = list.find((e) => e.id === id);
    return le
      ? {
          type: 'legal_entity',
          id,
          title: le.name,
          subtitle: `${le.legalName} · ${le.countryCode}`,
          propertyId: null,
          label: ctx.t('records.types.legal_entity'),
        }
      : null;
  },
};

const user: RecordDefinition = {
  type: 'user',
  simulated: false,
  async load(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.users(ctx.app.session));
    const u = list.find((x) => x.userId === id);
    if (!u) return null;
    const t = ctx.t;
    const propName = (pid: string | null) =>
      ctx.app.properties.find((p) => p.id === pid)?.name ?? pid ?? t('admin.wholeOrganization');
    return {
      history: { state: 'unavailable' },
      model: {
        type: 'user',
        id,
        typeLabel: t('records.types.user'),
        title: u.displayName,
        subtitle: u.email,
        status: [{ family: t('admin.status'), value: u.status }],
        provenance: { kind: 'live' },
        actions: [
          disabled(
            'assignRole',
            t('records.actions.assignRole'),
            t('records.reasons.apiMissing', { what: 'role assignment endpoint' }),
          ),
        ],
        issues:
          u.roles.length === 0
            ? [{ code: 'no_roles', severity: 'warning', message: t('admin.noRolesIssue') }]
            : [],
        sections: [
          {
            id: 'roles',
            title: t('records.sections.roles'),
            content: (
              <ul className="flex flex-col gap-1 text-sm">
                {u.roles.map((r) => (
                  <li key={`${r.key}:${r.scopeId}`} className="flex gap-2">
                    <span className="pt-code">{r.key}</span>
                    <span className="text-ink-muted">
                      · {r.scopeType === 'organization' ? t('admin.wholeOrganization') : propName(r.scopeId)}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          },
        ],
        links: u.roles
          .filter((r) => r.scopeType === 'property' && r.scopeId)
          .map((r) => ({
            rel: r.key,
            type: 'property',
            id: r.scopeId as string,
            title: propName(r.scopeId),
          })),
        helpKey: 'settings.users.record',
      },
    };
  },
  async summary(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.users(ctx.app.session));
    const u = list.find((x) => x.userId === id);
    return u
      ? {
          type: 'user',
          id,
          title: u.displayName,
          subtitle: u.email,
          propertyId: null,
          label: ctx.t('records.types.user'),
          status: { status: u.status },
        }
      : null;
  },
};

function workspaceFor(ctx: RecordCtx) {
  const p = ctx.app.property;
  if (!p) throw new Error('No property selected');
  const { sources } = bindWorkspaceSources(ctx.app.session.organization.environment);
  const records = sources.records;
  if (!records) throw new Error('Records for this property are not connected yet.');
  return { property: propertyContext(p), records };
}

const notYet = (ctx: RecordCtx, action: string, label: string) =>
  disabled(action, label, ctx.t('records.reasons.notAvailableYet'));

const DEPARTMENT: Record<string, string> = {
  unit_assigned: 'front_desk',
  unit_ready: 'housekeeping',
  payment_secured: 'front_desk',
  registration: 'front_desk',
  requests: 'housekeeping',
};

const stay: RecordDefinition = {
  type: 'stay',
  simulated: true,
  async load(ctx, id) {
    const { property, records } = workspaceFor(ctx);
    const res = await records.stay(property, id);
    const s = res.data;
    if (!s) return null;
    const t = ctx.t;
    const nights = Math.round((Date.parse(s.departure) - Date.parse(s.arrival)) / 86_400_000);
    const r = s.readiness;
    const blocker = r?.blockingReason ?? null;
    const secured = r?.checks.find((c) => c.key === 'payment_secured') ?? null;
    // Check-in is offered only on the arrival day, for an expected stay that is ready (FD-02).
    const checkIn: RecordAction =
      s.stayStatus !== 'expected'
        ? disabled(
            'checkIn',
            t('records.actions.checkIn'),
            t('records.reasons.notExpected', { status: t(`ui.status.stay.${s.stayStatus}`) }),
          )
        : s.arrival > property.businessDate
          ? disabled(
              'checkIn',
              t('records.actions.checkIn'),
              t('records.reasons.notArrivalDay', { date: formatLocalDate(s.arrival, ctx.lng) }),
            )
          : blocker
            ? disabled('checkIn', t('records.actions.checkIn'), blocker.message)
            : { action: 'checkIn', label: t('records.actions.checkIn'), enabled: true };
    const guests = [
      t('arrivals.adults', { count: s.occupancy.adults }),
      s.occupancy.childrenAges.length
        ? t('arrivals.children', { count: s.occupancy.childrenAges.length })
        : '',
    ]
      .filter(Boolean)
      .join(', ');
    const d = s.arrivalDetails;
    const facts: Array<[string, ReactNode]> = [
      [t('arrivals.nights'), String(nights)],
      [t('arrivals.occupancy'), guests],
      ...(s.nightlyRate
        ? ([
            [
              t('timeline.nightlyRate'),
              <span key="r" className="pt-code">
                {formatMoney(s.nightlyRate, ctx.lng)}
              </span>,
            ],
          ] as Array<[string, ReactNode]>)
        : []),
      ...(secured ? ([[t('desk.secured'), secured.message]] as Array<[string, ReactNode]>) : []),
      [
        t('arrivals.balance'),
        s.balance ? (
          <span key="b" className="pt-code">
            {formatMoney(s.balance, ctx.lng)}
            {s.stayStatus !== 'departed' && <span className="text-ink-muted"> ({t('desk.estimate')})</span>}
          </span>
        ) : (
          '—'
        ),
      ],
      [
        t('arrivals.requests'),
        s.requests.map((q) => `${q.text} (${t(`records.requestStatus.${q.status}`)})`).join(' · ') ||
          t('arrivals.noRequests'),
      ],
      ...(s.checkedInAt
        ? ([
            [t('desk.checkedIn'), formatTime(s.checkedInAt, ctx.app.property?.timezone ?? 'UTC', ctx.lng)],
          ] as Array<[string, ReactNode]>)
        : []),
    ];
    return {
      history: { state: 'ready', items: s.history },
      model: {
        type: 'stay',
        id,
        typeLabel: t('records.types.stay'),
        title: s.guestName ?? s.bookingCode,
        code: s.bookingCode,
        subtitle: `${s.unitName ?? t('arrivals.unassigned')} · ${s.unitTypeName ?? ''} · ${formatLocalDate(s.arrival, ctx.lng, 'short')} → ${formatLocalDate(s.departure, ctx.lng, 'short')}`,
        // Separate questions, separate chips (C3.2): no payment chip for a stay — Secured and Balance are facts.
        status: [
          ...(s.bookingStatus
            ? [{ family: 'booking', vocabulary: 'booking' as const, value: s.bookingStatus }]
            : []),
          { family: 'stay', vocabulary: 'stay', value: s.stayStatus },
          ...(s.unitCondition
            ? [{ family: 'condition', vocabulary: 'condition' as const, value: s.unitCondition }]
            : []),
        ],
        provenance: {
          kind: res.provenance.kind,
          ...(res.provenance.generatedAt ? { lastSyncedAt: res.provenance.generatedAt } : {}),
        },
        actions: [
          checkIn,
          {
            action: 'extend',
            label: t('records.actions.extendStay'),
            enabled: s.stayStatus !== 'departed',
            previewRequired: true,
          },
          notYet(ctx, 'move', t('records.actions.moveUnit')),
          { action: 'timeline', label: t('records.actions.showOnTimeline'), enabled: true },
          notYet(ctx, 'cancel', t('records.actions.cancelBooking')),
        ],
        issues: (r?.checks ?? [])
          .filter((c) => c.status !== 'ok')
          .map((c) => ({
            code: c.key,
            severity: c.status === 'unknown' ? ('warning' as const) : ('blocking' as const),
            message: c.message,
            owner: {
              kind: 'department' as const,
              id: DEPARTMENT[c.key] ?? 'front_desk',
              name: t(`desk.departments.${DEPARTMENT[c.key] ?? 'front_desk'}`),
            },
          })),
        sections: [
          ...(r
            ? [
                {
                  id: 'readiness',
                  title: t('records.sections.readiness'),
                  helpKey: 'frontDesk.arrivals.readiness',
                  content: <ReadinessChecks checks={r.checks} />,
                },
              ]
            : []),
          ...(d
            ? [
                {
                  id: 'arrival',
                  title: t('records.sections.arrival'),
                  content: (
                    <Facts
                      items={[
                        [
                          t('arrivals.transport'),
                          `${t(`arrivals.transportModes.${d.transportMode}`)}${d.number ? ` ${d.number}` : ''}`,
                        ],
                        [t('arrivals.inbound'), d.inbound ?? '—'],
                        [
                          t('arrivals.eta'),
                          d.estimatedTime && d.estimatedTime !== d.scheduledTime
                            ? t('records.etaDelayed', {
                                scheduled: d.scheduledTime ?? '—',
                                estimated: d.estimatedTime,
                                reason: d.delayReason ?? '',
                              })
                            : (d.scheduledTime ?? '—'),
                        ],
                        [t('arrivals.arrivalPoint'), d.arrivalPoint ?? '—'],
                      ]}
                    />
                  ),
                },
              ]
            : []),
          { id: 'stay', title: t('records.sections.stay'), content: <Facts items={facts} /> },
        ],
        links: [
          ...(s.guestName
            ? [{ rel: t('records.types.guest'), type: 'guest', id: `${id}:guest`, title: s.guestName }]
            : []),
          ...(s.unitId
            ? [{ rel: t('records.types.unit'), type: 'unit', id: s.unitId, title: s.unitName ?? '' }]
            : []),
          ...(ctx.app.property
            ? [
                {
                  rel: t('records.types.property'),
                  type: 'property',
                  id: ctx.app.property.id,
                  title: ctx.app.property.name,
                },
              ]
            : []),
        ],
        helpKey: 'reservations.stay.record',
      },
    };
  },
  async summary(ctx, id) {
    const { property, records } = workspaceFor(ctx);
    const s = (await records.stay(property, id)).data;
    return s
      ? {
          type: 'stay',
          id,
          title: `${s.guestName ?? ''} · ${s.bookingCode}`,
          subtitle: `${s.unitName ?? ctx.t('arrivals.unassigned')} · ${s.arrival} → ${s.departure}`,
          status: { stay: s.stayStatus },
          propertyId: ctx.app.property?.id ?? null,
          label: ctx.t('records.types.stay'),
        }
      : null;
  },
  onAction(ctx, model, action, h) {
    if (action.action === 'extend') h.openExtend(model.id);
    else if (action.action === 'timeline') h.navigate('/reservations/timeline', { stay: model.id });
    else h.toast({ tone: 'info', title: ctx.t('records.simulatedAction', { action: action.label }) });
  },
};

const unit: RecordDefinition = {
  type: 'unit',
  simulated: true,
  async load(ctx, id) {
    const { property, records } = workspaceFor(ctx);
    const res = await records.unit(property, id);
    const u = res.data;
    if (!u) return null;
    const t = ctx.t;
    const r = u.row;
    const unitStatus = r.unit;
    const tz = ctx.app.property?.timezone ?? 'UTC';
    const assignee = r.openTasks[0]?.assigneeName ?? null;
    return {
      history: {
        state: 'ready',
        items: [
          {
            at: unitStatus.conditionChangedAt,
            action: 'operations.unit.conditionChanged',
            actor: { kind: 'user', label: assignee ?? t('desk.departments.housekeeping') },
            reason: `→ ${t(`ui.status.condition.${unitStatus.condition}`)}`,
          },
        ],
      },
      model: {
        type: 'unit',
        id,
        typeLabel: t('records.types.unit'),
        title: unitStatus.unitNumber,
        subtitle: [unitStatus.unitTypeCode, unitStatus.sectionName].filter(Boolean).join(' · '),
        status: [
          { family: 'condition', vocabulary: 'condition', value: unitStatus.condition },
          { family: 'occupancy', vocabulary: 'occupancy', value: unitStatus.occupancy },
          ...(unitStatus.discrepancy !== 'none'
            ? [{ family: 'discrepancy', vocabulary: 'discrepancy' as const, value: unitStatus.discrepancy }]
            : []),
          ...(unitStatus.block
            ? [
                {
                  family: 'unitAvailability',
                  vocabulary: 'unitAvailability' as const,
                  value: unitStatus.block.kind,
                },
              ]
            : []),
        ],
        provenance: {
          kind: res.provenance.kind,
          ...(res.provenance.generatedAt ? { lastSyncedAt: res.provenance.generatedAt } : {}),
        },
        actions: [
          unitStatus.condition === 'clean'
            ? { action: 'inspect', label: t('records.actions.markInspected'), enabled: true }
            : disabled(
                'inspect',
                t('records.actions.markInspected'),
                t('housekeeping.inspectReason', {
                  condition: t(`ui.status.condition.${unitStatus.condition}`),
                }),
              ),
          notYet(ctx, 'report', t('records.actions.reportIssue')),
        ],
        issues: [
          ...(unitStatus.condition === 'failed_inspection'
            ? [{ code: 'failed', severity: 'blocking' as const, message: r.priorityReasons.join(' · ') }]
            : []),
          ...(unitStatus.block
            ? [
                {
                  code: 'ooo',
                  severity: 'blocking' as const,
                  message: unitStatus.block.reason ?? t('ui.status.unitAvailability.out_of_order'),
                },
              ]
            : []),
          ...(unitStatus.discrepancy !== 'none'
            ? [
                {
                  code: 'discrepancy',
                  severity: 'warning' as const,
                  message: t(`ui.status.discrepancy.${unitStatus.discrepancy}`),
                },
              ]
            : []),
        ],
        ...(assignee ? { owner: { kind: 'user' as const, id: assignee, name: assignee } } : {}),
        sections: [
          {
            id: 'condition',
            title: t('records.sections.condition'),
            content: (
              <Facts
                items={[
                  [
                    t('housekeeping.priority'),
                    r.topPriority
                      ? `${t(`housekeeping.priorities.${r.topPriority}`)} · ${r.priorityReasons.join(' · ')}`
                      : '—',
                  ],
                  [
                    t('housekeeping.readyEstimate'),
                    unitStatus.readiness.expectedReadyAt
                      ? `≈ ${formatTime(unitStatus.readiness.expectedReadyAt, tz, ctx.lng)} (${t('housekeeping.estimate')})`
                      : '—',
                  ],
                  [t('housekeeping.dnd'), unitStatus.dnd ? t('common.yes') : t('common.no')],
                ]}
              />
            ),
          },
        ],
        links: u.stays
          .filter((i) => i.kind === 'stay')
          .map((i) => ({ rel: `${i.from} → ${i.to}`, type: 'stay', id: i.id, title: i.label })),
        helpKey: 'housekeeping.unit.record',
      },
    };
  },
  async summary(ctx, id) {
    const { property, records } = workspaceFor(ctx);
    const u = (await records.unit(property, id)).data;
    return u
      ? {
          type: 'unit',
          id,
          title: u.row.unit.unitNumber,
          subtitle: u.row.unit.unitTypeCode ?? undefined,
          status: { condition: u.row.unit.condition, occupancy: u.row.unit.occupancy },
          propertyId: ctx.app.property?.id ?? null,
          label: ctx.t('records.types.unit'),
        }
      : null;
  },
  onAction(ctx, _model, action, h) {
    h.toast({ tone: 'info', title: ctx.t('records.simulatedAction', { action: action.label }) });
  },
};

const guest: RecordDefinition = {
  type: 'guest',
  simulated: true,
  async load(ctx, id) {
    const stayId = id.replace(/:guest$/, '');
    const { property, records } = workspaceFor(ctx);
    const res = await records.stay(property, stayId);
    const s = res.data;
    if (!s) return null;
    const t = ctx.t;
    return {
      history: { state: 'unavailable' },
      model: {
        type: 'guest',
        id,
        typeLabel: t('records.types.guest'),
        title: s.guestName ?? s.bookingCode,
        subtitle: s.vip ? 'VIP' : undefined,
        status: [],
        provenance: { kind: res.provenance.kind },
        actions: [notYet(ctx, 'edit', t('records.actions.edit'))],
        issues: [],
        sections: [],
        links: [
          {
            rel: t('records.types.stay'),
            type: 'stay',
            id: stayId,
            title: `${s.bookingCode} · ${s.arrival} → ${s.departure}`,
          },
        ],
        helpKey: 'guests.profile.record',
      } as RecordModel,
    };
  },
  async summary(ctx, id) {
    const { property, records } = workspaceFor(ctx);
    const s = (await records.stay(property, id.replace(/:guest$/, ''))).data;
    return s
      ? {
          type: 'guest',
          id,
          title: s.guestName ?? s.bookingCode,
          propertyId: null,
          label: ctx.t('records.types.guest'),
        }
      : null;
  },
};

export const RECORD_TYPES: Record<string, RecordDefinition> = {
  property,
  legal_entity: legalEntity,
  user,
  stay,
  unit,
  guest,
};

export function definitionFor(type: string): RecordDefinition | undefined {
  return RECORD_TYPES[type];
}

/** Server history: 404 means "nothing recorded yet / not permitted" (indistinguishable by design). */
export async function serverHistory(type: string, id: string): Promise<HistoryState> {
  try {
    const r = await api.recordHistory(type, id);
    // Machine actors get staff names ("demo-seeder" → "System setup").
    const items = r.data.items.map((i) =>
      i.actor.kind !== 'user' || /seeder|system|worker/i.test(i.actor.label)
        ? { ...i, actor: { ...i.actor, label: /seed/i.test(i.actor.label) ? 'System setup' : 'Portico' } }
        : i,
    );
    return { state: 'ready', items };
  } catch (e) {
    if (isApiError(e) && e.status === 404) return { state: 'ready', items: [] };
    return {
      state: 'error',
      message: isApiError(e) ? e.problem.detail : 'History could not be loaded. Try again in a moment.',
    };
  }
}
