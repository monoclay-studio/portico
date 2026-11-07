import {
  addDays,
  EmptyState,
  ProblemAlert,
  ProvenanceBadge,
  SkeletonList,
  Timeline,
  type TimelineItem,
  useToast,
} from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { useWorkspace } from '../../data/use-workspace';
import { learning } from '../../learning/progress';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';
import { NotConnected, SourceNote } from '../common/source-note';

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={`inline-block h-3 w-6 rounded-sm ${className}`} />
      {label}
    </li>
  );
}

/** Reservations timeline (RES-R36): units × nights with stays, unit blocks and holds. SIMULATED for now. */
export function TimelinePage() {
  const { t } = useTranslation();
  const { property } = useApp();
  const toast = useToast();
  const nav = useRecordNav();
  const search = useSearch({ strict: false }) as { stay?: string; from?: string };
  const [from, setFrom] = useState<string | null>(search.from ?? null);
  const start = from ?? (property ? addDays(property.businessDate, -2) : '2026-01-01');
  const days = 21;
  const ws = useWorkspace();
  const source = ws.source('timeline');
  const query = useQuery({
    queryKey: ws.key('timeline', start, days),
    queryFn: () =>
      source && ws.property
        ? source.timeline(ws.property, start, days)
        : Promise.reject(new Error('unbound')),
    enabled: Boolean(source && ws.property),
    placeholderData: (prev) => prev,
  });
  const view = query.data?.data;
  const units = useMemo(
    () =>
      (view?.units ?? []).map((u) => ({
        id: u.unitId,
        label: u.unitNumber,
        group: u.unitTypeName,
        sublabel: t(`ui.status.condition.${u.condition}`),
      })),
    [view, t],
  );
  const items = useMemo<TimelineItem[]>(
    () =>
      (view?.items ?? []).map((i) => ({
        id: i.id,
        unitId: i.unitId,
        kind: i.kind,
        from: i.from,
        to: i.to,
        label: i.label,
        ...(i.stayStatus ? { stayStatus: i.stayStatus } : {}),
        ...(i.blockKind ? { blockKind: i.blockKind } : {}),
        flags: i.flags,
      })),
    [view],
  );
  if (!property) return <EmptyState title={t('app.noProperties')} />;

  return (
    <div>
      <PageHeader
        title={t('timeline.title')}
        subtitle={t('timeline.subtitle', { units: units.length })}
        meta={
          query.data && (
            <ProvenanceBadge
              provenance={query.data.provenance.kind}
              {...(query.data.provenance.generatedAt
                ? { generatedAt: query.data.provenance.generatedAt }
                : {})}
              timeZone={property?.timezone ?? 'UTC'}
            />
          )
        }
        helpKey="reservations.timeline"
      />
      <SourceNote provenance={query.data?.provenance} timeZone={property?.timezone ?? 'UTC'} />
      {!source && <NotConnected what={t('timeline.title')} />}
      <ul className="mb-3 flex flex-wrap gap-4" aria-label={t('timeline.legend')}>
        <Swatch
          className="border border-s-4 border-[var(--pt-bar-expected-line)] bg-[var(--pt-bar-expected)]"
          label={t('timeline.legendExpected')}
        />
        <Swatch className="bg-[var(--pt-bar-inhouse)]" label={t('timeline.legendInHouse')} />
        <Swatch
          className="border border-line bg-[var(--pt-bar-departed)]"
          label={t('timeline.legendDeparted')}
        />
        <Swatch
          className="pt-hatch border border-danger-line [--pt-hatch-a:var(--pt-bar-block)] [--pt-hatch-b:var(--pt-bar-block-stripe)]"
          label={t('timeline.legendBlock')}
        />
        <Swatch
          className="border-2 border-dashed border-[var(--pt-bar-hold-line)] bg-pending-bg"
          label={t('timeline.legendHold')}
        />
      </ul>
      {query.isPending && <SkeletonList rows={10} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'timeline')}
          onRetry={() => void query.refetch()}
        />
      )}
      {view && (
        <div className={query.isFetching ? 'opacity-70' : undefined}>
          <Timeline
            label={t('timeline.title')}
            units={units}
            items={items}
            from={start}
            days={days}
            today={property.businessDate}
            onRangeChange={setFrom}
            highlightId={search.stay}
            helpKey="reservations.timeline.grid"
            onItemActivate={(it) => {
              learning.event('record:open');
              if (it.kind === 'stay') nav.openFresh('stay', it.id);
              else nav.openFresh('unit', it.unitId);
            }}
            onCellActivate={(u, d) =>
              toast({ tone: 'info', title: t('timeline.walkIn', { unit: u.label, date: d }) })
            }
          />
        </div>
      )}
    </div>
  );
}
