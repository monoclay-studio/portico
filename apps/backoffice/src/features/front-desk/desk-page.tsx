import {
  Button,
  type ColumnDef,
  DataTable,
  type DataTableHandle,
  EmptyState,
  formatLocalDate,
  formatMoney,
  ProblemAlert,
  ProvenanceBadge,
  type SavedView,
  SkeletonList,
  StatusBadge,
  useHotkey,
  useToast,
} from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { ConciergeBell, Download, Star } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { PHONE_QUERY, useMediaQuery } from '../../app/use-media-query';
import type { DeskListKind } from '../../data/contracts';
import { composeDeskRows, type DeskRowView, deskState } from '../../data/front-desk';
import { useWorkspace } from '../../data/use-workspace';
import { learning } from '../../learning/progress';
import { RecordLink } from '../../records/entity-link';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';
import { NotConnected, SourceNote } from '../common/source-note';
import { builtInView, useSavedViews } from '../common/use-saved-views';
import { downloadCsv } from './csv';
import { ReadinessCell, SecuredCell } from './readiness';

const HELP: Record<DeskListKind, string> = {
  arrivals: 'frontDesk.arrivals',
  'in-house': 'frontDesk.inHouse',
  departures: 'frontDesk.departures',
};
const TITLE: Record<DeskListKind, string> = {
  arrivals: 'arrivals.title',
  'in-house': 'desk.inHouseTitle',
  departures: 'desk.departuresTitle',
};
/** Flags that only repeat what the list itself says. */
const IMPLIED: Record<DeskListKind, string[]> = {
  arrivals: ['arriving_today'],
  'in-house': [],
  departures: ['departing_today'],
};

type Filter = 'all' | 'blocked' | 'ready' | 'checked_in' | 'balance';

/**
 * Front-desk lists (vision "07:30, arrivals rush"; FD-06): arrivals with the single blocker per guest, in house
 * and departures — one layout, reservations' desk rows enriched with operations' unit facts. Count chips filter
 * the same rows they count (NAV-07); the open record follows j/k (split view, SR P1-5).
 */
export function DeskPage({ kind }: { kind: DeskListKind }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? 'en';
  const { me } = useApp();
  const ws = useWorkspace();
  const property = ws.property;
  const toast = useToast();
  const nav = useRecordNav();
  const phone = useMediaQuery(PHONE_QUERY);
  const table = useRef<DataTableHandle>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const frontDesk = ws.source('frontDesk');
  const housekeeping = ws.source('housekeeping');
  const desk = useQuery({
    queryKey: ws.key('frontDesk', kind),
    queryFn: () =>
      frontDesk && property ? frontDesk.list(property, kind) : Promise.reject(new Error('unbound')),
    enabled: Boolean(frontDesk && property),
  });
  // Operations enriches rows (condition, VIP, who is cleaning); the list still works without it.
  const board = useQuery({
    queryKey: ws.key('housekeeping', 'board'),
    queryFn: () =>
      housekeeping && property ? housekeeping.board(property) : Promise.reject(new Error('unbound')),
    enabled: Boolean(housekeeping && property),
  });
  const rows = useMemo(
    () => (desk.data ? composeDeskRows(desk.data.data, board.data?.data) : []),
    [desk.data, board.data],
  );
  const shown = useMemo(() => {
    switch (filter) {
      case 'blocked':
        return rows.filter((r) => deskState(r) === 'blocked');
      case 'ready':
        return rows.filter((r) => deskState(r) === 'ready');
      case 'checked_in':
        return rows.filter((r) => deskState(r) === 'checked_in');
      case 'balance':
        return rows.filter((r) => (r.balance?.amountMinor ?? 0) > 0);
      default:
        return rows;
    }
  }, [rows, filter]);

  const builtIn = useMemo<SavedView[]>(
    () => [
      builtInView('all', t('desk.viewAll'), {
        sort: kind === 'arrivals' ? { columnId: 'eta', direction: 'asc' } : null,
        hidden: ['nights', 'stay'],
      }),
      ...(kind === 'arrivals'
        ? [
            builtInView('blocked', t('arrivals.viewBlocked'), {
              sort: { columnId: 'readiness', direction: 'asc' },
              hidden: ['nights', 'stay'],
            }),
          ]
        : []),
    ],
    [t, kind],
  );
  const saved = useSavedViews(`desk.${kind}`, me.userId, builtIn);
  const tz = property?.timezone ?? 'UTC';

  const columns = useMemo<ColumnDef<DeskRowView>[]>(() => {
    const guest: ColumnDef<DeskRowView> = {
      id: 'guest',
      header: t('arrivals.guest'),
      accessor: (r) => r.guestName ?? r.bookingCode,
      searchText: (r) =>
        [r.bookingCode, ...r.flags.map((f) => t(`desk.flags.${f}`, { defaultValue: f }))].join(' '),
      hideable: false,
      priority: 1,
      width: 'minmax(11rem, 1.2fr)',
      cell: (r) => {
        const flags = r.flags.filter((f) => !IMPLIED[kind].includes(f));
        return (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              {r.vip && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-warning-bg px-1 text-xs font-semibold text-warning-fg">
                  <Star aria-hidden className="size-3" />
                  {t('arrivals.vip')}
                </span>
              )}
              <bdi className="truncate">{r.guestName ?? t('desk.noName')}</bdi>
              {/* The readiness cell already says "Checked in"; other stay states get a chip here. */}
              {r.stayStatus !== 'expected' && r.stayStatus !== 'in_house' && (
                <StatusBadge vocabulary="stay" value={r.stayStatus} />
              )}
            </span>
            <span className="truncate text-xs text-ink-muted">
              <span className="pt-code">{r.bookingCode}</span>
              {flags.length > 0 &&
                ` · ${flags.map((f) => t(`desk.flags.${f}`, { defaultValue: f })).join(' · ')}`}
            </span>
          </span>
        );
      },
    };
    const unit: ColumnDef<DeskRowView> = {
      id: 'unit',
      header: t('arrivals.villa'),
      accessor: (r) => r.unitName ?? '',
      priority: 2,
      width: 'minmax(7.5rem, 0.7fr)',
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
          {r.unitTypeCode && <span className="truncate text-xs text-ink-muted">{r.unitTypeCode}</span>}
        </span>
      ),
    };
    const balance: ColumnDef<DeskRowView> = {
      id: 'balance',
      header: t('arrivals.balance'),
      accessor: (r) => r.balance?.amountMinor ?? null,
      align: 'end',
      priority: kind === 'arrivals' ? 4 : 2,
      width: '9rem',
      cell: (r) =>
        r.balance ? (
          <span className="flex flex-col items-end leading-tight">
            <span className="pt-code">{formatMoney(r.balance, lng)}</span>
            <span className="text-xs text-ink-muted">{t('desk.estimate')}</span>
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    };
    const nights: ColumnDef<DeskRowView> = {
      id: 'nights',
      header: t('arrivals.nights'),
      accessor: (r) => r.nights,
      width: '5rem',
      align: 'end',
      priority: 5,
    };
    const stay: ColumnDef<DeskRowView> = {
      id: 'stay',
      header: t('arrivals.stayStatus'),
      accessor: (r) => r.stayStatus,
      width: '8rem',
      priority: 5,
      filter: 'select',
      cell: (r) => <StatusBadge vocabulary="stay" value={r.stayStatus} />,
    };
    if (kind === 'arrivals')
      return [
        guest,
        {
          id: 'readiness',
          header: t('arrivals.readiness'),
          accessor: (r) => deskState(r),
          searchText: (r) => r.blocker?.message ?? '',
          compare: (a, b) => (a === b ? 0 : a === 'blocked' ? -1 : b === 'blocked' ? 1 : 0),
          priority: 1,
          width: 'minmax(18rem, 3fr)',
          cell: (r) => <ReadinessCell row={r} />,
        },
        {
          id: 'eta',
          header: t('arrivals.eta'),
          accessor: (r) => r.eta,
          priority: 2,
          width: '5.5rem',
          cell: (r) => <span className="pt-tabular font-medium">{r.eta ?? '—'}</span>,
        },
        unit,
        {
          id: 'secured',
          header: `${t('arrivals.condition')} · ${t('desk.secured')}`,
          accessor: (r) => r.unitCondition ?? '',
          priority: 3,
          width: '11rem',
          cell: (r) => (
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              {r.unitCondition ? (
                <StatusBadge vocabulary="condition" value={r.unitCondition} />
              ) : (
                <span className="text-xs text-ink-subtle">—</span>
              )}
              <SecuredCell check={r.secured} />
            </span>
          ),
        },
        balance,
        nights,
        stay,
      ];
    return [
      guest,
      unit,
      {
        id: 'departure',
        header: kind === 'departures' ? t('desk.departure') : t('desk.night'),
        accessor: (r) => r.departure,
        priority: 2,
        width: '9rem',
        cell: (r) =>
          kind === 'departures' ? (
            <span>{formatLocalDate(r.departure, lng, 'short')}</span>
          ) : (
            <span className="flex flex-col leading-tight">
              <span>
                {t('desk.nightOf', {
                  n: Math.min(r.nights, Math.max(1, nightIndex(r, property?.businessDate))),
                  total: r.nights,
                })}
              </span>
              <span className="text-xs text-ink-muted">
                {t('desk.departs', { date: formatLocalDate(r.departure, lng, 'short') })}
              </span>
            </span>
          ),
      },
      balance,
      nights,
      stay,
    ];
  }, [t, kind, lng, property?.businessDate]);

  // Split view: while a stay from this list is open, j / k (outside the grid) show the next / previous one.
  const openTop = nav.trail[0];
  const openId = openTop?.type === 'stay' ? openTop.id : null;
  useHotkey('j', () => table.current?.move(1), { enabled: Boolean(openId) });
  useHotkey('k', () => table.current?.move(-1), { enabled: Boolean(openId) });

  if (!property) return <EmptyState title={t('app.noProperties')} />;
  const title = t(TITLE[kind]);
  if (!frontDesk) {
    return (
      <div>
        <PageHeader title={title} helpKey={HELP[kind]} />
        <NotConnected what={title} />
      </div>
    );
  }
  const open = (r: DeskRowView) => {
    learning.event('record:open');
    nav.openFresh('stay', r.stayId);
  };
  const count = (f: (r: DeskRowView) => boolean) => rows.filter(f).length;
  const chips: Array<{ id: Filter; label: string; n: number }> = [
    { id: 'all', label: t('desk.chipAll'), n: rows.length },
    ...(kind === 'arrivals'
      ? [
          {
            id: 'blocked' as const,
            label: t('arrivals.summaryBlocked'),
            n: count((r) => deskState(r) === 'blocked'),
          },
          {
            id: 'ready' as const,
            label: t('arrivals.summaryReady'),
            n: count((r) => deskState(r) === 'ready'),
          },
          {
            id: 'checked_in' as const,
            label: t('arrivals.summaryInHouse'),
            n: count((r) => deskState(r) === 'checked_in'),
          },
        ]
      : [
          {
            id: 'balance' as const,
            label: t('desk.chipBalance'),
            n: count((r) => (r.balance?.amountMinor ?? 0) > 0),
          },
        ]),
  ];
  const listLabel = t(`desk.listLabel.${kind}`, {
    count: rows.length,
    date: formatLocalDate(property.businessDate, lng),
  });

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={listLabel}
        meta={
          desk.data && (
            <ProvenanceBadge
              provenance={desk.data.provenance.kind}
              {...(desk.data.provenance.generatedAt ? { generatedAt: desk.data.provenance.generatedAt } : {})}
              timeZone={tz}
            />
          )
        }
        helpKey={HELP[kind]}
      />
      <SourceNote provenance={desk.data?.provenance} timeZone={tz} />
      {desk.isPending && <SkeletonList rows={8} />}
      {desk.isError && (
        <ProblemAlert problem={problemFromUnknown(desk.error, kind)} onRetry={() => void desk.refetch()} />
      )}
      {desk.data && (
        <>
          {/* Count chips ARE filters over the same rows (NAV-07, FD-14): the number always equals the list. */}
          <fieldset
            aria-label={t('desk.filterBy')}
            className="sticky top-0 z-[5] -mx-1 mb-3 flex min-w-0 flex-wrap gap-2 border-0 bg-canvas px-1 py-1"
          >
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={filter === c.id}
                data-desk-filter={c.id}
                onClick={() => setFilter(c.id)}
                className={
                  filter === c.id
                    ? 'min-h-9 rounded-full border border-accent bg-accent-soft px-3 text-sm font-semibold text-ink'
                    : 'min-h-9 rounded-full border border-line bg-surface px-3 text-sm text-ink-muted hover:text-ink'
                }
              >
                {c.label} <span className="pt-tabular font-semibold">{c.n}</span>
              </button>
            ))}
          </fieldset>
          {rows.length === 0 ? (
            <EmptyState
              icon={<ConciergeBell />}
              title={t(`desk.empty.${kind}`)}
              description={t('arrivals.emptyHelp')}
            />
          ) : phone ? (
            <ul className="flex flex-col gap-2" aria-label={listLabel}>
              {shown.map((r) => (
                <li key={r.stayId}>
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-start hover:bg-surface-hover"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-semibold">
                        {r.vip && <Star aria-label={t('arrivals.vip')} className="size-4 text-warning-fg" />}
                        <bdi>{r.guestName ?? r.bookingCode}</bdi>
                      </span>
                      <span className="pt-tabular font-medium">{r.eta ?? ''}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
                      {r.unitName ?? t('arrivals.unassigned')}
                      {r.unitCondition && <StatusBadge vocabulary="condition" value={r.unitCondition} />}
                      {r.balance && (
                        <span className="pt-code">
                          {t('arrivals.balance')} {formatMoney(r.balance, lng)}
                        </span>
                      )}
                    </span>
                    {kind === 'arrivals' && <ReadinessCell row={r} wrap />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <DataTable
              label={listLabel}
              columns={columns}
              rows={shown}
              getRowId={(r) => r.stayId}
              onRowActivate={open}
              onRowPrimaryAction={open}
              openRowId={openId}
              followActive
              handleRef={table}
              selectable
              bulkActions={(selected, clear) => (
                <>
                  {kind === 'arrivals' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        toast({
                          tone: 'info',
                          title: t('desk.bulkDelayTitle', { count: selected.length }),
                          description: t('desk.bulkDelayDetail'),
                        })
                      }
                    >
                      {t('desk.bulkDelay')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon={<Download />}
                    onClick={() => {
                      downloadCsv(`${kind}-${property.businessDate}.csv`, selected, [
                        [t('arrivals.guest'), (r) => r.guestName ?? ''],
                        [t('desk.code'), (r) => r.bookingCode],
                        [t('arrivals.villa'), (r) => r.unitName ?? ''],
                        [t('arrivals.eta'), (r) => r.eta ?? ''],
                        [
                          t('arrivals.readiness'),
                          (r) => r.blocker?.message ?? t(`desk.state.${deskState(r)}`),
                        ],
                        [t('arrivals.balance'), (r) => (r.balance ? formatMoney(r.balance, lng) : '')],
                      ]);
                      clear();
                    }}
                  >
                    {t('desk.exportCsv')}
                  </Button>
                </>
              )}
              views={saved.views}
              onSaveView={saved.onSaveView}
              onDeleteView={saved.onDeleteView}
              rowLines={kind === 'arrivals' ? 3 : 2}
              helpKey={`${HELP[kind]}.board`}
              rowClassName={(r) =>
                deskState(r) === 'blocked' ? 'border-s-4 border-s-danger-solid' : undefined
              }
              toolbar={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void desk.refetch()}
                  loading={desk.isFetching}
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

function nightIndex(r: DeskRowView, businessDate: string | undefined): number {
  if (!businessDate) return 1;
  return Math.round((Date.parse(businessDate) - Date.parse(r.arrival)) / 86_400_000) + 1;
}

export const ArrivalsScreen = () => <DeskPage kind="arrivals" />;
export const InHouseScreen = () => <DeskPage kind="in-house" />;
export const DeparturesScreen = () => <DeskPage kind="departures" />;
