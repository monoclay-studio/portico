import { type ColumnDef, DataTable, EmptyState, formatTime, ProblemAlert, ProvenanceBadge, type SavedView, SkeletonList } from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { workspaceSource } from '../../data/sources';
import type { SimWorkItem } from '../../mocks/adapter';
import { RecordLink } from '../../records/entity-link';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';
import { toSimProperty } from '../common/sim-property';
import { SimulatedNote } from '../common/simulated-note';
import { builtInView, useSavedViews } from '../common/use-saved-views';

const RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/**
 * "My work" inbox (experience architecture §2): one prioritised list across modules. SIMULATED until the
 * operations task model and integration exceptions merge; each item links to its record.
 */
export function MyWorkPage() {
  const { t, i18n } = useTranslation();
  const { property, me } = useApp();
  const nav = useRecordNav();
  const query = useQuery({
    queryKey: ['sim', property?.id, property?.businessDate, 'my-work'],
    queryFn: () => workspaceSource.myWork(toSimProperty(property as NonNullable<typeof property>)),
    enabled: Boolean(property),
  });
  const tz = property?.timezone ?? 'UTC';
  const builtIn = useMemo<SavedView[]>(
    () => [
      builtInView('urgent', t('myWork.viewUrgent'), { sort: { columnId: 'priority', direction: 'asc' }, filters: {}, search: '', hidden: [] }),
      builtInView('all', t('myWork.viewAll'), { sort: { columnId: 'due', direction: 'asc' }, filters: {}, search: '', hidden: [] }),
      builtInView('approvals', t('myWork.viewApprovals'), { sort: null, filters: { kind: 'approval' }, search: '', hidden: [] }),
    ],
    [t],
  );
  const saved = useSavedViews('my-work', me.userId, builtIn);
  const columns = useMemo<ColumnDef<SimWorkItem>[]>(
    () => [
      {
        id: 'priority',
        header: t('myWork.priority'),
        accessor: (w) => RANK[w.priority],
        width: '7rem',
        cell: (w) => (
          <span className={w.priority === 'urgent' ? 'font-semibold text-danger-fg' : w.priority === 'high' ? 'font-semibold text-warning-fg' : ''}>
            {t(`housekeeping.priorities.${w.priority}`)}
          </span>
        ),
      },
      {
        id: 'kind',
        header: t('myWork.kind'),
        accessor: (w) => w.kind,
        width: '8rem',
        filter: 'select',
        filterOptions: (['exception', 'task', 'approval', 'handover'] as const).map((k) => ({ value: k, label: t(`myWork.kinds.${k}`) })),
        cell: (w) => <span className="pt-data">{t(`myWork.kinds.${w.kind}`)}</span>,
      },
      {
        id: 'item',
        header: t('myWork.item'),
        accessor: (w) => `${w.title} ${w.detail}`,
        hideable: false,
        width: 'minmax(18rem, 3fr)',
        cell: (w) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{w.title}</span>
            <span className="truncate text-xs text-ink-muted">{w.detail}</span>
          </span>
        ),
      },
      {
        id: 'record',
        header: t('myWork.record'),
        accessor: (w) => w.record?.title ?? '',
        width: 'minmax(10rem, 1.2fr)',
        cell: (w) =>
          w.record ? (
            <RecordLink type={w.record.type} id={w.record.id} fresh>
              {w.record.title}
            </RecordLink>
          ) : (
            <span className="text-ink-subtle">—</span>
          ),
      },
      { id: 'module', header: t('myWork.module'), accessor: (w) => w.module, width: '8rem', filter: 'select' },
      { id: 'department', header: t('myWork.department'), accessor: (w) => w.department, width: '9rem' },
      { id: 'assignee', header: t('myWork.assignee'), accessor: (w) => w.assignee ?? '', width: '10rem' },
      { id: 'due', header: t('myWork.due'), accessor: (w) => w.dueAt ?? '', width: '6rem', cell: (w) => <span className="pt-code">{w.dueAt ? formatTime(w.dueAt, tz, i18n.resolvedLanguage) : '—'}</span> },
    ],
    [t, tz, i18n.resolvedLanguage],
  );
  if (!property) return <EmptyState title={t('app.noProperties')} />;
  return (
    <div>
      <PageHeader
        title={t('myWork.title')}
        subtitle={t('myWork.subtitle')}
        meta={query.data && <ProvenanceBadge provenance={query.data.provenance} lastSyncedAt={query.data.generatedAt} />}
        helpKey="overview.myWork"
      />
      <SimulatedNote module="operations + integration" />
      {query.isPending && <SkeletonList rows={6} />}
      {query.isError && <ProblemAlert problem={problemFromUnknown(query.error, 'my-work')} onRetry={() => void query.refetch()} />}
      {query.data && (
        <DataTable
          label={t('myWork.title')}
          columns={columns}
          rows={query.data.data}
          getRowId={(w) => w.id}
          views={saved.views}
          onSaveView={saved.onSaveView}
          onDeleteView={saved.onDeleteView}
          rowLines={2}
          helpKey="overview.myWork.table"
          onRowActivate={(w) => w.record && nav.openFresh(w.record.type, w.record.id)}
        />
      )}
    </div>
  );
}
