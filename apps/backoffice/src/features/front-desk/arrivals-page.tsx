import {
  Button,
  type ColumnDef,
  DataTable,
  EmptyState,
  formatLocalDate,
  ProblemAlert,
  ProvenanceBadge,
  type SavedView,
  SkeletonList,
  STATUS_VALUES,
  StatusBadge,
  useUi,
} from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, ConciergeBell, DoorClosed, Star, Timer } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { PHONE_QUERY, useMediaQuery } from '../../app/use-media-query';
import { workspaceSource } from '../../data/sources';
import { learning } from '../../learning/progress';
import type { ArrivalRow } from '../../mocks/contracts';
import { RecordLink } from '../../records/entity-link';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';
import { toSimProperty } from '../common/sim-property';
import { SimulatedNote } from '../common/simulated-note';
import { builtInView, useSavedViews } from '../common/use-saved-views';
import { EtaCell } from './eta';
import { ReadinessCell } from './readiness';

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex min-w-36 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <span aria-hidden className={`inline-flex [&_svg]:size-5 ${tone}`}>
        {icon}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="pt-tabular text-xl font-semibold">{value}</span>
        <span className="text-xs text-ink-muted">{label}</span>
      </div>
    </div>
  );
}

/**
 * Front desk arrivals board (vision: "07:30, arrivals rush"): each arrival's readiness and the single blocker
 * to clear. SIMULATED data until reservations + operations merge.
 */
export function ArrivalsPage() {
  const { t, i18n } = useTranslation();
  const { strings } = useUi();
  const { property, me } = useApp();
  const nav = useRecordNav();
  const phone = useMediaQuery(PHONE_QUERY);
  const query = useQuery({
    queryKey: ['sim', property?.id, property?.businessDate, 'arrivals'],
    queryFn: () => workspaceSource.arrivals(toSimProperty(property as NonNullable<typeof property>)),
    enabled: Boolean(property),
  });
  const rows = query.data?.data ?? [];
  const tz = property?.timezone ?? 'UTC';

  const builtIn = useMemo<SavedView[]>(
    () => [
      builtInView('all', t('arrivals.viewAll'), {
        sort: { columnId: 'eta', direction: 'asc' },
        filters: {},
        search: '',
        hidden: ['nights'],
      }),
      builtInView('blocked', t('arrivals.viewBlocked'), {
        sort: { columnId: 'eta', direction: 'asc' },
        filters: { readiness: 'blocked' },
        search: '',
        hidden: ['nights'],
      }),
      builtInView('vip', t('arrivals.viewVip'), {
        sort: { columnId: 'eta', direction: 'asc' },
        filters: { vip: 'yes' },
        search: '',
        hidden: ['nights'],
      }),
      builtInView('seaplane', t('arrivals.viewSeaplane'), {
        sort: { columnId: 'eta', direction: 'asc' },
        filters: { transport: 'seaplane' },
        search: '',
        hidden: ['nights'],
      }),
    ],
    [t],
  );
  const saved = useSavedViews('arrivals', me.userId, builtIn);

  const columns = useMemo<ColumnDef<ArrivalRow>[]>(
    () => [
      {
        id: 'guest',
        header: t('arrivals.guest'),
        accessor: (r) => r.guestName,
        hideable: false,
        width: 'minmax(11rem, 1.2fr)',
        cell: (r) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex items-center gap-1.5 truncate font-medium">
              {r.vip && (
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-warning-bg px-1 text-[0.625rem] font-bold uppercase text-warning-fg">
                  <Star aria-hidden className="size-3" />
                  {t('arrivals.vip')}
                </span>
              )}
              <span className="truncate">{r.guestName}</span>
            </span>
            <span className="pt-code truncate text-xs text-ink-muted">
              {r.bookingCode}
              {r.flags.length > 0 && ` · ${r.flags.join(', ')}`}
            </span>
          </span>
        ),
      },
      {
        id: 'eta',
        header: t('arrivals.eta'),
        accessor: (r) => r.eta,
        width: '8.5rem',
        cell: (r) => <EtaCell row={r} timeZone={tz} />,
      },
      {
        id: 'unit',
        header: t('arrivals.villa'),
        accessor: (r) => r.unitName ?? '',
        width: 'minmax(8rem, 0.8fr)',
        cell: (r) => (
          <span className="flex min-w-0 flex-col leading-tight">
            {r.unitName && r.unitId ? (
              <span className="pt-code font-medium">
                <RecordLink type="unit" id={r.unitId}>
                  {r.unitName}
                </RecordLink>
              </span>
            ) : (
              <span className="font-medium text-danger-fg">{t('arrivals.unassigned')}</span>
            )}
            <span className="truncate text-xs text-ink-muted">{r.unitTypeName}</span>
          </span>
        ),
      },
      {
        id: 'condition',
        header: t('arrivals.condition'),
        accessor: (r) => r.unitCondition ?? '',
        width: '9.5rem',
        filter: 'select',
        filterOptions: STATUS_VALUES.condition.map((v) => ({ value: v, label: strings.status.condition[v] })),
        cell: (r) =>
          r.unitCondition ? (
            <StatusBadge vocabulary="condition" value={r.unitCondition} />
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      {
        id: 'payment',
        header: t('arrivals.payment'),
        accessor: (r) => r.paymentStatus,
        width: '11rem',
        filter: 'select',
        filterOptions: STATUS_VALUES.payment.map((v) => ({ value: v, label: strings.status.payment[v] })),
        cell: (r) => <StatusBadge vocabulary="payment" value={r.paymentStatus} />,
      },
      {
        id: 'readiness',
        header: t('arrivals.readiness'),
        accessor: (r) => (r.readiness.ready ? 'ready' : 'blocked'),
        compare: (a, b) => (a === b ? 0 : a === 'blocked' ? -1 : 1),
        width: 'minmax(14rem, 2fr)',
        filter: 'select',
        filterOptions: [
          { value: 'ready', label: t('arrivals.ready') },
          { value: 'blocked', label: t('arrivals.notReady') },
        ],
        cell: (r) => <ReadinessCell row={r} />,
      },
      {
        id: 'stay',
        header: t('arrivals.stayStatus'),
        accessor: (r) => r.stayStatus,
        width: '7.5rem',
        cell: (r) => <StatusBadge vocabulary="stay" value={r.stayStatus} />,
      },
      { id: 'nights', header: t('arrivals.nights'), accessor: (r) => r.nights, width: '5rem', align: 'end' },
      {
        id: 'owner',
        header: t('arrivals.owner'),
        accessor: (r) => r.owner ?? '',
        width: 'minmax(9rem, 1fr)',
      },
      {
        id: 'vip',
        header: t('arrivals.vip'),
        accessor: (r) => (r.vip ? 'yes' : 'no'),
        width: '5rem',
        cell: (r) => (r.vip ? t('common.yes') : t('common.no')),
      },
      {
        id: 'transport',
        header: t('arrivals.transport'),
        accessor: (r) => r.arrivalDetails.transportMode,
        width: '9rem',
        cell: (r) => t(`arrivals.transportModes.${r.arrivalDetails.transportMode}`),
      },
    ],
    [t, tz, strings],
  );
  // The VIP and transport columns exist for saved-view filters; hide them by default.
  const visibleViews = useMemo(
    () =>
      saved.views.map((v) => ({
        ...v,
        state: { ...v.state, hidden: [...new Set([...v.state.hidden, 'vip', 'transport'])] },
      })),
    [saved.views],
  );

  if (!property) return <EmptyState title={t('app.noProperties')} />;
  const openTop = nav.trail[0];
  const selected = openTop?.type === 'stay' ? (rows.find((r) => r.stayId === openTop.id) ?? null) : null;
  const open = (r: ArrivalRow) => {
    learning.event('record:open');
    nav.openFresh('stay', r.stayId);
  };
  const count = (f: (r: ArrivalRow) => boolean) => rows.filter(f).length;

  return (
    <div>
      <PageHeader
        title={t('arrivals.title')}
        subtitle={t('arrivals.subtitle', {
          count: rows.length,
          date: formatLocalDate(property.businessDate, i18n.resolvedLanguage),
        })}
        meta={
          query.data && (
            <ProvenanceBadge provenance={query.data.provenance} lastSyncedAt={query.data.generatedAt} />
          )
        }
        helpKey="frontDesk.arrivals"
      />
      <SimulatedNote module="reservations + operations" />
      {query.isPending && <SkeletonList rows={8} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'arrivals')}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2" aria-label={t('arrivals.readiness')} role="group">
            <Stat
              icon={<CircleCheck />}
              tone="text-success-fg"
              label={t('arrivals.summaryReady')}
              value={count((r) => r.readiness.ready && r.stayStatus === 'expected')}
            />
            <Stat
              icon={<CircleX />}
              tone="text-danger-fg"
              label={t('arrivals.summaryBlocked')}
              value={count((r) => !r.readiness.ready)}
            />
            <Stat
              icon={<DoorClosed />}
              tone="text-info-fg"
              label={t('arrivals.summaryInHouse')}
              value={count((r) => r.stayStatus === 'in_house')}
            />
            <Stat
              icon={<Timer />}
              tone="text-warning-fg"
              label={t('arrivals.summaryDelayed')}
              value={count((r) => r.arrivalDetails.estimatedAt !== r.arrivalDetails.scheduledAt)}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={<ConciergeBell />}
              title={t('arrivals.empty')}
              description={t('arrivals.emptyHelp')}
            />
          ) : phone ? (
            <ul className="flex flex-col gap-2" aria-label={t('arrivals.title')}>
              {rows.map((r) => (
                <li key={r.stayId}>
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-start hover:bg-surface-hover"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{r.guestName}</span>
                      <EtaCell row={r} timeZone={tz} />
                    </span>
                    <span className="text-sm text-ink-muted">
                      {r.unitName ?? t('arrivals.unassigned')} · {r.unitTypeName}
                    </span>
                    <ReadinessCell row={r} />
                    <span className="flex flex-wrap gap-1.5">
                      {r.unitCondition && <StatusBadge vocabulary="condition" value={r.unitCondition} />}
                      <StatusBadge vocabulary="payment" value={r.paymentStatus} />
                      <StatusBadge vocabulary="stay" value={r.stayStatus} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <DataTable
              label={t('arrivals.subtitle', { count: rows.length, date: property.businessDate })}
              columns={columns}
              rows={rows}
              getRowId={(r) => r.stayId}
              onRowActivate={open}
              selectedRowId={selected?.stayId ?? null}
              views={visibleViews}
              onSaveView={saved.onSaveView}
              onDeleteView={saved.onDeleteView}
              rowLines={2}
              helpKey="frontDesk.arrivals.board"
              rowClassName={(r) => (!r.readiness.ready ? 'border-s-4 border-s-danger-solid' : undefined)}
              toolbar={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void query.refetch()}
                  loading={query.isFetching}
                >
                  {t('common.refresh')}
                </Button>
              }
            />
          )}
        </>
      )}
    </div>
  );
}
