import {
  type ColumnDef,
  DataTable,
  EmptyState,
  formatTime,
  ProblemAlert,
  ProvenanceBadge,
  type SavedView,
  SkeletonList,
  STATUS_VALUES,
  StatusBadge,
  useUi,
} from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { BellOff, Star, Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { PHONE_QUERY, useMediaQuery } from '../../app/use-media-query';
import type { BoardRow } from '../../data/contracts';
import { useWorkspace } from '../../data/use-workspace';
import { learning } from '../../learning/progress';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';
import { NotConnected, SourceNote } from '../common/source-note';
import { builtInView, useSavedViews } from '../common/use-saved-views';

/** One board row as this screen shows it (operations `boardRow`, flattened). */
interface HousekeepingRow {
  unitId: string;
  unitNumber: string;
  unitTypeName: string;
  sectionName: string;
  condition: string;
  occupancy: string;
  discrepancy: string;
  dnd: boolean;
  block: { kind: string; reason: string } | null;
  arrival: { stayId: string; eta: string | null; vip: boolean; guestLabel: string } | null;
  departureToday: boolean;
  topPriority: 'low' | 'normal' | 'high' | 'urgent' | null;
  priorityReasons: string[];
  assigneeName: string | null;
  expectedReadyAt: string | null;
  ready: boolean;
}

function toRow(r: BoardRow): HousekeepingRow {
  const u = r.unit;
  return {
    unitId: u.unitId,
    unitNumber: u.unitNumber,
    unitTypeName: u.unitTypeCode ?? '',
    sectionName: u.sectionName ?? '',
    condition: u.condition,
    occupancy: u.occupancy,
    discrepancy: u.discrepancy,
    dnd: u.dnd,
    block: u.block ? { kind: u.block.kind, reason: u.block.reason ?? '' } : null,
    arrival: r.arrival
      ? {
          stayId: r.arrival.stayId,
          eta: r.arrival.eta,
          vip: r.arrival.vip,
          guestLabel: r.arrival.guestLabel ?? '',
        }
      : null,
    departureToday: Boolean(r.departureToday),
    topPriority: r.topPriority,
    priorityReasons: r.priorityReasons,
    assigneeName: r.openTasks[0]?.assigneeName ?? null,
    expectedReadyAt: u.readiness.expectedReadyAt,
    ready: u.readiness.ready,
  };
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/** Housekeeping board (OPS-R10): units × condition, occupancy, priorities from arrivals, estimated ready times. */
export function HousekeepingPage() {
  const { t, i18n } = useTranslation();
  const { strings } = useUi();
  const { property, me } = useApp();
  const phone = useMediaQuery(PHONE_QUERY);
  const nav = useRecordNav();
  const ws = useWorkspace();
  const source = ws.source('housekeeping');
  const query = useQuery({
    queryKey: ws.key('housekeeping', 'board'),
    queryFn: () => (source && ws.property ? source.board(ws.property) : Promise.reject(new Error('unbound'))),
    enabled: Boolean(source && ws.property),
  });
  const rows = useMemo(() => (query.data?.data.rows ?? []).map(toRow), [query.data]);
  const tz = property?.timezone ?? 'UTC';
  const lng = i18n.resolvedLanguage;

  const builtIn = useMemo<SavedView[]>(
    () => [
      builtInView('arrivals-first', t('housekeeping.viewArrivalsFirst'), {
        sort: { columnId: 'priority', direction: 'asc' },
        filters: {},
        search: '',
        hidden: [],
      }),
      builtInView('all', t('housekeeping.viewAll'), {
        sort: { columnId: 'unit', direction: 'asc' },
        filters: {},
        search: '',
        hidden: [],
      }),
      builtInView('failed', t('housekeeping.viewFailed'), {
        sort: null,
        filters: { condition: 'failed_inspection' },
        search: '',
        hidden: [],
      }),
    ],
    [t],
  );
  const saved = useSavedViews('housekeeping', me.userId, builtIn);

  const columns = useMemo<ColumnDef<HousekeepingRow>[]>(
    () => [
      {
        id: 'unit',
        header: t('housekeeping.unit'),
        accessor: (r) => r.unitNumber,
        hideable: false,
        width: 'minmax(10rem, 1fr)',
        cell: (r) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex items-center gap-1.5 font-medium">
              {r.unitNumber}
              {r.dnd && (
                <span className="inline-flex items-center gap-0.5 text-xs font-normal text-pending-fg">
                  <BellOff aria-hidden className="size-3.5" />
                  {t('housekeeping.dnd')}
                </span>
              )}
            </span>
            <span className="truncate text-xs text-ink-muted">{r.unitTypeName}</span>
          </span>
        ),
      },
      {
        id: 'section',
        priority: 5,
        header: t('housekeeping.section'),
        accessor: (r) => r.sectionName,
        width: '8rem',
        filter: 'select',
      },
      {
        id: 'condition',
        header: t('housekeeping.condition'),
        accessor: (r) => r.condition,
        width: '11rem',
        filter: 'select',
        filterOptions: STATUS_VALUES.condition.map((v) => ({ value: v, label: strings.status.condition[v] })),
        cell: (r) => <StatusBadge vocabulary="condition" value={r.condition} />,
      },
      {
        id: 'occupancy',
        priority: 2,
        header: t('housekeeping.occupancy'),
        accessor: (r) => r.occupancy,
        width: '11rem',
        cell: (r) => (
          <span className="flex flex-col gap-0.5">
            <StatusBadge vocabulary="occupancy" value={r.occupancy} />
            {r.discrepancy !== 'none' && <StatusBadge vocabulary="occupancy" value={r.discrepancy} />}
          </span>
        ),
      },
      {
        id: 'arrival',
        header: t('housekeeping.arrival'),
        accessor: (r) => r.arrival?.eta ?? '',
        width: '9rem',
        cell: (r) =>
          r.arrival ? (
            <span className="flex items-center gap-1 text-sm">
              {r.arrival.vip && <Star aria-label={t('arrivals.vip')} className="size-3.5 text-warning-fg" />}
              <span className="pt-tabular">{r.arrival.eta ? formatTime(r.arrival.eta, tz, lng) : '—'}</span>
              <span className="truncate text-xs text-ink-muted">{r.arrival.guestLabel}</span>
            </span>
          ) : r.departureToday ? (
            <span className="text-xs text-ink-muted">{t('housekeeping.departureToday')}</span>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'priority',
        header: t('housekeeping.priority'),
        accessor: (r) => (r.topPriority ? PRIORITY_RANK[r.topPriority] : null),
        width: 'minmax(14rem, 2fr)',
        cell: (r) =>
          r.topPriority ? (
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={
                  r.topPriority === 'urgent'
                    ? 'font-semibold text-danger-fg'
                    : r.topPriority === 'high'
                      ? 'font-semibold text-warning-fg'
                      : 'font-medium'
                }
              >
                {t(`housekeeping.priorities.${r.topPriority}`)}
              </span>
              <span className="truncate text-xs text-ink-muted">{r.priorityReasons.join(' · ')}</span>
            </span>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'attendant',
        priority: 3,
        header: t('housekeeping.attendant'),
        accessor: (r) => r.assigneeName ?? '',
        width: '8rem',
        filter: 'select',
        cell: (r) =>
          r.assigneeName ?? <span className="text-ink-subtle">{t('housekeeping.unassigned')}</span>,
      },
      {
        id: 'ready',
        priority: 4,
        header: t('housekeeping.readyEstimate'),
        accessor: (r) => r.expectedReadyAt ?? '',
        width: '9rem',
        cell: (r) =>
          r.block ? (
            <span className="flex items-center gap-1 text-xs text-danger-fg" title={r.block.reason}>
              <Wrench aria-hidden className="size-3.5" />
              <span className="truncate">{r.block.reason}</span>
            </span>
          ) : r.expectedReadyAt ? (
            <span className="pt-tabular text-sm italic">
              ≈ {formatTime(r.expectedReadyAt, tz, lng)}{' '}
              <span className="text-xs not-italic text-ink-muted">({t('housekeeping.estimate')})</span>
            </span>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
    ],
    [t, tz, lng, strings],
  );

  if (!property) return <EmptyState title={t('app.noProperties')} />;
  const counts = STATUS_VALUES.condition.map(
    (c) => [c, rows.filter((r) => r.condition === c).length] as const,
  );
  const notReadyArrivals = rows.filter((r) => r.arrival && !r.ready).length;

  return (
    <div>
      <PageHeader
        title={t('housekeeping.title')}
        subtitle={t('housekeeping.subtitle', { units: rows.length, arrivals: notReadyArrivals })}
        meta={
          query.data && (
            <ProvenanceBadge
              provenance={query.data.provenance.kind}
              {...(query.data.provenance.generatedAt
                ? { generatedAt: query.data.provenance.generatedAt }
                : {})}
              timeZone={tz}
            />
          )
        }
        helpKey="housekeeping.board"
      />
      <SourceNote provenance={query.data?.provenance} timeZone={tz} />
      {!source && <NotConnected what={t('housekeeping.title')} />}
      {query.isPending && <SkeletonList rows={8} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'housekeeping')}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <>
          <ul className="mb-4 flex flex-wrap gap-2" aria-label={t('housekeeping.condition')}>
            {counts.map(([c, n]) => (
              <li
                key={c}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
              >
                <StatusBadge vocabulary="condition" value={c} />
                <span className="pt-tabular text-lg font-semibold">{n}</span>
              </li>
            ))}
          </ul>
          {phone ? (
            <ul className="flex flex-col gap-2">
              {[...rows]
                .sort(
                  (a, b) =>
                    (a.topPriority ? PRIORITY_RANK[a.topPriority] : 9) -
                    (b.topPriority ? PRIORITY_RANK[b.topPriority] : 9),
                )
                .map((r) => (
                  <li key={r.unitId}>
                    <button
                      type="button"
                      onClick={() => nav.openFresh('unit', r.unitId)}
                      className="flex w-full flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 text-start"
                    >
                      <span className="flex items-center justify-between font-semibold">
                        {r.unitNumber}
                        <StatusBadge vocabulary="condition" value={r.condition} size="md" />
                      </span>
                      <span className="flex flex-wrap gap-2 text-sm text-ink-muted">
                        <StatusBadge vocabulary="occupancy" value={r.occupancy} />
                        {r.topPriority && (
                          <span>
                            {t(`housekeeping.priorities.${r.topPriority}`)} · {r.priorityReasons.join(' · ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <DataTable
              label={t('housekeeping.title')}
              columns={columns}
              rows={rows}
              getRowId={(r) => r.unitId}
              views={saved.views}
              onSaveView={saved.onSaveView}
              onDeleteView={saved.onDeleteView}
              rowLines={2}
              helpKey="housekeeping.board.table"
              onRowActivate={(r) => {
                learning.event('record:open');
                nav.openFresh('unit', r.unitId);
              }}
              openRowId={nav.trail[0]?.type === 'unit' ? nav.trail[0].id : null}
            />
          )}
        </>
      )}
    </div>
  );
}
