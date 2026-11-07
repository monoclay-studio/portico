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
  StepTracker,
} from '@portico/ui';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { api, isApiError } from '../api';
import { queries } from '../api/queries';
import type { AppContextValue } from '../app/app-context';
import { workspaceSource } from '../data/sources';
import { Facts } from '../features/common/page-header';
import { toSimProperty } from '../features/common/sim-property';
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

const disabled = (action: string, label: string, reason: string): RecordAction => ({ action, label, enabled: false, reason });

const property: RecordDefinition = {
  type: 'property',
  simulated: false,
  async load(ctx, id) {
    const org = ctx.app.session.organization.id;
    const { property: p, version } = await ctx.queryClient.fetchQuery(queries.property(org, id),
    );
    const entities = await ctx.queryClient.fetchQuery(queries.legalEntities(org)).catch(() => []);
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
          p.status === 'setup'
            ? [{ code: 'setup', severity: 'info', message: t('admin.setupIssue') }]
            : [],
        owner: { kind: 'department', id: 'org-admins', name: t('admin.ownerAdmins') },
        sections: [
          {
            id: 'details',
            title: t('records.sections.details'),
            helpKey: 'settings.properties.details',
            content: (
              <Facts
                items={[
                  [t('admin.code'), <span key="c" className="pt-code">{p.code}</span>],
                  [t('admin.profile'), t(`profiles.${p.profile}`)],
                  [t('admin.timezone'), p.timezone],
                  [t('admin.currency'), p.baseCurrency],
                  [t('app.businessDate'), <span key="bd" className="pt-code">{p.businessDate}</span>],
                  [t('admin.checkInTime'), p.checkInTime],
                  [t('admin.checkOutTime'), p.checkOutTime],
                  [t('common.version', { version }), ''],
                ]}
              />
            ),
          },
          {
            id: 'classification',
            title: t('records.sections.classification'),
            collapsed: true,
            content: (
              <Facts items={Object.entries(p.classification).map(([k, v]) => [<span key={k} className="pt-code">{k}</span>, String(v)])} />
            ),
          },
        ],
        links: le ? [{ rel: t('records.types.legal_entity'), type: 'legal_entity', id: le.id, title: le.name }] : [],
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
    const org = ctx.app.session.organization.id;
    const list = await ctx.queryClient.fetchQuery(queries.legalEntities(org));
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
        actions: [disabled('edit', t('records.actions.edit'), t('records.reasons.apiMissing', { what: 'PATCH /v1/legal-entities/:id' }))],
        issues: le.taxId ? [] : [{ code: 'tax_id_missing', severity: 'warning', message: t('admin.taxIdMissing') }],
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
        links: props.map((p) => ({ rel: t('records.types.property'), type: 'property', id: p.id, title: p.name })),
        helpKey: 'settings.legalEntities.record',
      },
    };
  },
  async summary(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.legalEntities(ctx.app.session.organization.id));
    const le = list.find((e) => e.id === id);
    return le ? { type: 'legal_entity', id, title: le.name, subtitle: `${le.legalName} · ${le.countryCode}`, propertyId: null, label: ctx.t('records.types.legal_entity') } : null;
  },
};

const user: RecordDefinition = {
  type: 'user',
  simulated: false,
  async load(ctx, id) {
    const org = ctx.app.session.organization.id;
    const list = await ctx.queryClient.fetchQuery(queries.users(org));
    const u = list.find((x) => x.userId === id);
    if (!u) return null;
    const t = ctx.t;
    const propName = (pid: string | null) => ctx.app.properties.find((p) => p.id === pid)?.name ?? pid ?? t('admin.wholeOrganization');
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
        actions: [disabled('assignRole', t('records.actions.assignRole'), t('records.reasons.apiMissing', { what: 'role assignment endpoint' }))],
        issues: u.roles.length === 0 ? [{ code: 'no_roles', severity: 'warning', message: t('admin.noRolesIssue') }] : [],
        sections: [
          {
            id: 'roles',
            title: t('records.sections.roles'),
            content: (
              <ul className="flex flex-col gap-1 text-sm">
                {u.roles.map((r) => (
                  <li key={`${r.key}:${r.scopeId}`} className="flex gap-2">
                    <span className="pt-code">{r.key}</span>
                    <span className="text-ink-muted">· {r.scopeType === 'organization' ? t('admin.wholeOrganization') : propName(r.scopeId)}</span>
                  </li>
                ))}
              </ul>
            ),
          },
        ],
        links: u.roles
          .filter((r) => r.scopeType === 'property' && r.scopeId)
          .map((r) => ({ rel: r.key, type: 'property', id: r.scopeId as string, title: propName(r.scopeId) })),
        helpKey: 'settings.users.record',
      },
    };
  },
  async summary(ctx, id) {
    const list = await ctx.queryClient.fetchQuery(queries.users(ctx.app.session.organization.id));
    const u = list.find((x) => x.userId === id);
    return u ? { type: 'user', id, title: u.displayName, subtitle: u.email, propertyId: null, label: ctx.t('records.types.user'), status: { status: u.status } } : null;
  },
};

function requireProperty(ctx: RecordCtx) {
  const p = ctx.app.property;
  if (!p) throw new Error('No property selected');
  return toSimProperty(p);
}

const stay: RecordDefinition = {
  type: 'stay',
  simulated: true,
  async load(ctx, id) {
    const res = await workspaceSource.stay(requireProperty(ctx), id);
    const s = res.data;
    if (!s) return null;
    const t = ctx.t;
    const a = s.arrival;
    const tz = ctx.app.property?.timezone ?? 'UTC';
    const nights = Math.round((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000);
    const blocker = a?.readiness.blockingReason;
    const checkIn: RecordAction =
      s.status !== 'expected'
        ? disabled('checkIn', t('records.actions.checkIn'), t('records.reasons.notExpected', { status: t(`ui.status.stay.${s.status}`) }))
        : blocker
          ? disabled('checkIn', t('records.actions.checkIn'), blocker.message)
          : { action: 'checkIn', label: t('records.actions.checkIn'), enabled: true };
    return {
      history: { state: 'ready', items: s.history },
      model: {
        type: 'stay',
        id,
        typeLabel: t('records.types.stay'),
        title: s.guestName,
        code: s.bookingCode,
        subtitle: `${s.unitName ?? t('arrivals.unassigned')} · ${s.unitTypeName} · ${formatLocalDate(s.from, ctx.lng, 'short')} → ${formatLocalDate(s.to, ctx.lng, 'short')}`,
        status: [
          { family: 'booking', vocabulary: 'booking', value: a?.bookingStatus ?? 'confirmed' },
          { family: 'stay', vocabulary: 'stay', value: s.status },
          ...(a ? [{ family: 'payment', vocabulary: 'payment' as const, value: a.paymentStatus }] : []),
          ...(a?.unitCondition ? [{ family: 'condition', vocabulary: 'condition' as const, value: a.unitCondition }] : []),
        ],
        provenance: { kind: 'simulated', lastSyncedAt: res.generatedAt },
        actions: [
          checkIn,
          { action: 'extend', label: t('records.actions.extendStay'), enabled: s.status !== 'departed', previewRequired: true },
          disabled('move', t('records.actions.moveUnit'), t('records.reasons.moduleNotConnected', { module: 'reservations' })),
          { action: 'timeline', label: t('records.actions.showOnTimeline'), enabled: true },
          disabled('cancel', t('records.actions.cancelBooking'), t('records.reasons.moduleNotConnected', { module: 'reservations' })),
        ],
        issues: (a?.readiness.checks ?? [])
          .filter((c) => c.status !== 'ok')
          .map((c) => ({
            code: c.key,
            severity: c.status === 'attention' ? ('warning' as const) : ('blocking' as const),
            message: c.message,
            ...(blocker?.key === c.key && blocker.owner ? { owner: { kind: 'department' as const, id: c.key, name: blocker.owner } } : {}),
          })),
        ...(a?.owner ? { owner: { kind: 'user' as const, id: a.owner, name: a.owner } } : {}),
        sections: [
          ...(a
            ? [
                { id: 'readiness', title: t('records.sections.readiness'), helpKey: 'frontDesk.arrivals.readiness', content: <ReadinessChecks checks={a.readiness.checks} /> },
                ...(a.checkInRun
                  ? [{ id: 'checkin', title: t('records.sections.checkIn'), helpKey: 'reservations.checkIn', content: <StepTracker steps={a.checkInRun.steps} /> }]
                  : []),
                {
                  id: 'arrival',
                  title: t('records.sections.arrival'),
                  content: (
                    <Facts
                      items={[
                        [t('arrivals.transport'), `${t(`arrivals.transportModes.${a.arrivalDetails.transportMode}`)}${a.arrivalDetails.carrier ? ` · ${a.arrivalDetails.carrier}` : ''}${a.arrivalDetails.number ? ` ${a.arrivalDetails.number}` : ''}`],
                        [t('arrivals.inbound'), a.arrivalDetails.inbound ?? '—'],
                        [
                          t('arrivals.eta'),
                          `${a.arrivalDetails.scheduledAt ? `${formatTime(a.arrivalDetails.scheduledAt, tz, ctx.lng)} ${t('arrivals.scheduled')}` : '—'}${a.arrivalDetails.estimatedAt && a.arrivalDetails.estimatedAt !== a.arrivalDetails.scheduledAt ? ` → ${formatTime(a.arrivalDetails.estimatedAt, tz, ctx.lng)} (${t('arrivals.estimated')})` : ''}`,
                        ],
                        [t('arrivals.arrivalPoint'), a.arrivalDetails.arrivalPoint ?? '—'],
                      ]}
                    />
                  ),
                },
              ]
            : []),
          {
            id: 'stay',
            title: t('records.sections.stay'),
            content: (
              <Facts
                items={[
                  [t('arrivals.nights'), String(nights)],
                  [t('arrivals.occupancy'), [t('arrivals.adults', { count: s.adults }), s.childrenAges.length ? t('arrivals.children', { count: s.childrenAges.length }) : ''].filter(Boolean).join(', ')],
                  [t('timeline.nightlyRate'), <span key="r" className="pt-code">{formatMoney(s.nightlyRate, ctx.lng)}</span>],
                  ...(a ? ([[t('arrivals.balance'), <span key="b" className="pt-code">{formatMoney(a.balance, ctx.lng)}</span>], [t('arrivals.requests'), a.requests.join(' · ') || t('arrivals.noRequests')]] as Array<[string, ReactNode]>) : []),
                ]}
              />
            ),
          },
        ],
        links: [
          { rel: t('records.types.guest'), type: 'guest', id: `${id}:guest`, title: s.guestName },
          ...(s.unitId ? [{ rel: t('records.types.unit'), type: 'unit', id: s.unitId, title: s.unitName ?? '' }] : []),
          ...(ctx.app.property ? [{ rel: t('records.types.property'), type: 'property', id: ctx.app.property.id, title: ctx.app.property.name }] : []),
        ],
        helpKey: 'reservations.stay.record',
      },
    };
  },
  async summary(ctx, id) {
    const s = (await workspaceSource.stay(requireProperty(ctx), id)).data;
    return s
      ? {
          type: 'stay',
          id,
          title: `${s.guestName} · ${s.bookingCode}`,
          subtitle: `${s.unitName ?? ctx.t('arrivals.unassigned')} · ${s.from} → ${s.to}`,
          status: { stay: s.status, ...(s.arrival ? { payment: s.arrival.paymentStatus } : {}) },
          propertyId: ctx.app.property?.id ?? null,
          label: ctx.t('records.types.stay'),
        }
      : null;
  },
  onAction(ctx, model, action, h) {
    if (action.action === 'extend') h.openExtend(model.id);
    else if (action.action === 'timeline') h.navigate('/reservations/timeline', { stay: model.id });
    else h.toast({ tone: 'pending', title: ctx.t('records.simulatedAction', { action: action.label }) });
  },
};

const unit: RecordDefinition = {
  type: 'unit',
  simulated: true,
  async load(ctx, id) {
    const res = await workspaceSource.unit(requireProperty(ctx), id);
    const u = res.data;
    if (!u) return null;
    const t = ctx.t;
    const r = u.row;
    const tz = ctx.app.property?.timezone ?? 'UTC';
    return {
      history: {
        state: 'ready',
        items: [
          { at: res.generatedAt, action: 'operations.unit.conditionChanged', actor: { kind: 'user', label: r.assigneeName ?? 'Housekeeping' }, reason: `→ ${t(`ui.status.condition.${r.condition}`)}` },
        ],
      },
      model: {
        type: 'unit',
        id,
        typeLabel: t('records.types.unit'),
        title: r.unitNumber,
        subtitle: `${r.unitTypeName} · ${r.sectionName}`,
        status: [
          { family: 'condition', vocabulary: 'condition', value: r.condition },
          { family: 'occupancy', vocabulary: 'occupancy', value: r.occupancy },
          ...(r.discrepancy !== 'none' ? [{ family: 'discrepancy', vocabulary: 'occupancy' as const, value: r.discrepancy }] : []),
          ...(r.block ? [{ family: 'availability', vocabulary: 'availability' as const, value: 'blocked' }] : []),
        ],
        provenance: { kind: 'simulated', lastSyncedAt: res.generatedAt },
        actions: [
          r.condition === 'clean'
            ? { action: 'inspect', label: t('records.actions.markInspected'), enabled: true }
            : disabled('inspect', t('records.actions.markInspected'), t('housekeeping.inspectReason', { condition: t(`ui.status.condition.${r.condition}`) })),
          disabled('report', t('records.actions.reportIssue'), t('records.reasons.moduleNotConnected', { module: 'operations' })),
        ],
        issues: [
          ...(r.condition === 'failed_inspection' ? [{ code: 'failed', severity: 'blocking' as const, message: r.priorityReasons.join(' · ') }] : []),
          ...(r.block ? [{ code: 'ooo', severity: 'blocking' as const, message: r.block.reason }] : []),
          ...(r.discrepancy !== 'none' ? [{ code: 'discrepancy', severity: 'warning' as const, message: t(`ui.status.occupancy.${r.discrepancy}`) }] : []),
        ],
        ...(r.assigneeName ? { owner: { kind: 'user' as const, id: r.assigneeName, name: r.assigneeName } } : {}),
        sections: [
          {
            id: 'condition',
            title: t('records.sections.condition'),
            content: (
              <Facts
                items={[
                  [t('housekeeping.priority'), r.topPriority ? `${t(`housekeeping.priorities.${r.topPriority}`)} · ${r.priorityReasons.join(' · ')}` : '—'],
                  [t('housekeeping.readyEstimate'), r.expectedReadyAt ? `≈ ${formatTime(r.expectedReadyAt, tz, ctx.lng)} (${t('housekeeping.estimate')})` : '—'],
                  [t('housekeeping.dnd'), r.dnd ? t('common.yes') : t('common.no')],
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
    const u = (await workspaceSource.unit(requireProperty(ctx), id)).data;
    return u
      ? { type: 'unit', id, title: u.row.unitNumber, subtitle: u.row.unitTypeName, status: { condition: u.row.condition, occupancy: u.row.occupancy }, propertyId: ctx.app.property?.id ?? null, label: ctx.t('records.types.unit') }
      : null;
  },
  onAction(ctx, _model, action, h) {
    h.toast({ tone: 'pending', title: ctx.t('records.simulatedAction', { action: action.label }) });
  },
};

const guest: RecordDefinition = {
  type: 'guest',
  simulated: true,
  async load(ctx, id) {
    const stayId = id.replace(/:guest$/, '');
    const s = (await workspaceSource.stay(requireProperty(ctx), stayId)).data;
    if (!s) return null;
    const t = ctx.t;
    return {
      history: { state: 'unavailable' },
      model: {
        type: 'guest',
        id,
        typeLabel: t('records.types.guest'),
        title: s.guestName,
        subtitle: s.vip ? 'VIP' : undefined,
        status: [],
        provenance: { kind: 'simulated' },
        actions: [disabled('edit', t('records.actions.edit'), t('records.reasons.moduleNotConnected', { module: 'guests' }))],
        issues: [],
        sections: [],
        links: [{ rel: t('records.types.stay'), type: 'stay', id: stayId, title: `${s.bookingCode} · ${s.from} → ${s.to}` }],
        helpKey: 'guests.profile.record',
      } as RecordModel,
    };
  },
  async summary(ctx, id) {
    const s = (await workspaceSource.stay(requireProperty(ctx), id.replace(/:guest$/, ''))).data;
    return s ? { type: 'guest', id, title: s.guestName, propertyId: null, label: ctx.t('records.types.guest') } : null;
  },
};

export const RECORD_TYPES: Record<string, RecordDefinition> = { property, legal_entity: legalEntity, user, stay, unit, guest };

export function definitionFor(type: string): RecordDefinition | undefined {
  return RECORD_TYPES[type];
}

/** Server history: 404 means "nothing recorded yet / not permitted" (indistinguishable by design). */
export async function serverHistory(type: string, id: string): Promise<HistoryState> {
  try {
    const r = await api.recordHistory(type, id);
    return { state: 'ready', items: r.data.items };
  } catch (e) {
    if (isApiError(e) && e.status === 404) return { state: 'ready', items: [] };
    return { state: 'error', message: isApiError(e) ? e.problem.detail : String(e) };
  }
}
