import {
  Button,
  EmptyState,
  formatLocalDate,
  formatMoney,
  KpiTile,
  ProblemAlert,
  ProvenanceBadge,
  SegmentedBar,
  SkeletonList,
  SmallMultiples,
} from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BedDouble,
  CircleAlert,
  CircleCheck,
  ConciergeBell,
  DoorClosed,
  Hourglass,
  LogOut,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import type { DeskListKind } from '../../data/contracts';
import { composeDeskRows, deskState } from '../../data/front-desk';
import { useWorkspace } from '../../data/use-workspace';
import { PageHeader, Panel } from '../common/page-header';
import { NotConnected, SourceNote } from '../common/source-note';
import { FirstRunChecklist } from '../learn/first-run-checklist';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/**
 * "Today" overview (design direction): KPI tiles with the counts behind each number, one segmented bar and one
 * set of small multiples — each chart answers one question. It is for understanding; the boards are for doing.
 * SIMULATED until reservations / operations / payments merge.
 */
export function TodayPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? 'en';
  const navigate = useNavigate();
  const { property } = useApp();
  const [table, setTable] = useState(false);
  const ws = useWorkspace();
  const p = ws.property;
  const frontDesk = ws.source('frontDesk');
  const work = ws.source('work');
  // The SAME queries (same keys) as the lists the tiles open, so a tile always equals its list (NAV-07).
  const desk = (kind: DeskListKind) => ({
    queryKey: ws.key('frontDesk', kind),
    queryFn: () => (frontDesk && p ? frontDesk.list(p, kind) : Promise.reject(new Error('unbound'))),
    enabled: Boolean(frontDesk && p),
  });
  const arrivals = useQuery(desk('arrivals'));
  const departures = useQuery(desk('departures'));
  const inHouse = useQuery(desk('in-house'));
  const myWork = useQuery({
    queryKey: ws.key('work', 'my-work'),
    queryFn: () => (work && p ? work.myWork(p) : Promise.reject(new Error('unbound'))),
    enabled: Boolean(work && p),
  });
  const overview = useQuery({
    queryKey: ws.key('work', 'overview'),
    queryFn: () => (work && p ? work.overview(p) : Promise.reject(new Error('unbound'))),
    enabled: Boolean(work && p),
  });
  if (!property || !p) return <EmptyState title={t('app.noProperties')} />;
  const all = [arrivals, departures, inHouse, myWork, overview];
  const failed = all.find((q) => q.isError);
  const ready = all.every((q) => q.data);
  const nf = new Intl.NumberFormat(lng);
  const provenance = overview.data?.provenance;
  const badge = provenance ? (
    <ProvenanceBadge provenance={provenance.kind} compact interactive={false} />
  ) : null;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('today.title')}
        subtitle={t('today.subtitle', { property: property.name })}
        meta={
          provenance && (
            <ProvenanceBadge
              provenance={provenance.kind}
              {...(provenance.generatedAt ? { generatedAt: provenance.generatedAt } : {})}
              timeZone={p.timezone}
            />
          )
        }
        helpKey="overview.today"
      />
      <FirstRunChecklist />
      <SourceNote provenance={provenance} timeZone={p.timezone} />
      {!frontDesk && <NotConnected what={t('today.title')} />}
      {frontDesk && !ready && !failed && <SkeletonList rows={6} />}
      {failed && (
        <ProblemAlert
          problem={problemFromUnknown(failed.error, 'today')}
          onRetry={() => void failed.refetch()}
        />
      )}
      {ready &&
        arrivals.data &&
        departures.data &&
        inHouse.data &&
        myWork.data &&
        overview.data &&
        (() => {
          const o = overview.data.data;
          const arr = composeDeskRows(arrivals.data.data, null);
          const n = {
            total: arr.length,
            ready: arr.filter((r) => deskState(r) === 'ready').length,
            blocked: arr.filter((r) => deskState(r) === 'blocked').length,
            checkedIn: arr.filter((r) => deskState(r) === 'checked_in').length,
          };
          const dep = departures.data.data.items;
          const depBalance = dep.filter((r) => (r.balance?.amountMinor ?? 0) > 0).length;
          const house = inHouse.data.data.items;
          const guests = house.reduce((g, r) => g + r.occupancy.adults + r.occupancy.childrenAges.length, 0);
          const exceptions = myWork.data.data.filter((w) => w.kind === 'exception');
          const urgent = exceptions.filter((w) => w.priority === 'urgent').length;
          const occNow = pct(o.occupancy.occupied, o.occupancy.sellable);
          const occBefore = pct(o.occupancy.lastWeek.occupied, o.occupancy.lastWeek.sellable);
          const delta = occNow - occBefore;
          return (
            <>
              <section
                aria-label={t('today.title')}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                <KpiTile
                  label={t('today.occupancy')}
                  icon={<BedDouble />}
                  value={`${occNow}%`}
                  ratio={o.occupancy.occupied / Math.max(1, o.occupancy.sellable)}
                  counts={{
                    numerator: nf.format(o.occupancy.occupied),
                    denominator: nf.format(o.occupancy.sellable),
                    unit: t('today.units'),
                  }}
                  annotation={
                    o.occupancy.outOfOrder ? t('today.oooNote', { count: o.occupancy.outOfOrder }) : undefined
                  }
                  delta={{
                    label: t('today.points', { sign: delta >= 0 ? '+' : '−', count: Math.abs(delta) }),
                    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
                    goodWhen: 'up',
                    period: t('today.vsLastWeek'),
                  }}
                  definition={t('today.occupancyDef')}
                  provenance={badge}
                  onOpen={() => void navigate({ to: '/reservations/timeline' })}
                />
                <KpiTile
                  label={t('today.arrivals')}
                  icon={<ConciergeBell />}
                  value={nf.format(n.total)}
                  ratio={(n.ready + n.checkedIn) / Math.max(1, n.total)}
                  counts={{
                    numerator: n.ready + n.checkedIn,
                    denominator: n.total,
                    unit: t('today.readyOrIn'),
                  }}
                  annotation={t('today.arrivalsSplit', {
                    ready: n.ready,
                    checkedIn: n.checkedIn,
                    blocked: n.blocked,
                  })}
                  definition={t('today.arrivalsDef')}
                  provenance={badge}
                  onOpen={() => void navigate({ to: '/front-desk/arrivals' })}
                />
                <KpiTile
                  label={t('today.departures')}
                  icon={<LogOut />}
                  value={nf.format(dep.length)}
                  annotation={t('today.withBalance', { count: depBalance })}
                  definition={t('today.departuresDef')}
                  provenance={badge}
                  onOpen={() => void navigate({ to: '/front-desk/departures' })}
                />
                <KpiTile
                  label={t('today.inHouse')}
                  icon={<DoorClosed />}
                  value={nf.format(house.length)}
                  annotation={t('today.guests', { count: guests })}
                  definition={t('today.inHouseDef')}
                  provenance={badge}
                  onOpen={() => void navigate({ to: '/front-desk/in-house' })}
                />
                <KpiTile
                  label={t('today.exceptions')}
                  icon={<CircleAlert />}
                  value={nf.format(exceptions.length)}
                  annotation={t('today.urgent', { count: urgent })}
                  definition={t('today.exceptionsDef')}
                  provenance={badge}
                  tone={urgent > 0 ? 'attention' : 'default'}
                  onOpen={() => void navigate({ to: '/my-work' })}
                />
                <KpiTile
                  label={t('today.pending')}
                  icon={<Hourglass />}
                  value={nf.format(o.pendingVerification.count)}
                  annotation={t('today.pendingAmount', {
                    amount: formatMoney(o.pendingVerification.amount, lng),
                  })}
                  definition={t('today.pendingDef')}
                  provenance={badge}
                  tone={o.pendingVerification.count > 0 ? 'attention' : 'default'}
                  onOpen={() => void navigate({ to: '/my-work' })}
                />
              </section>
              <Panel title={t('today.readinessTitle')} helpKey="overview.today.readiness">
                <p className="mb-3 text-sm text-ink-muted">{t('today.readinessQuestion')}</p>
                <SegmentedBar
                  label={t('today.readinessTitle')}
                  unit={t('today.arrivalsUnit')}
                  onSelect={() => void navigate({ to: '/front-desk/arrivals' })}
                  segments={[
                    {
                      id: 'checkedIn',
                      label: t('today.checkedIn'),
                      value: n.checkedIn,
                      kind: 'neutral',
                      icon: <DoorClosed />,
                    },
                    {
                      id: 'ready',
                      label: t('today.ready'),
                      value: n.ready,
                      kind: 'good',
                      icon: <CircleCheck />,
                    },
                    {
                      id: 'blocked',
                      label: t('today.blocked'),
                      value: n.blocked,
                      kind: 'critical',
                      icon: <CircleAlert />,
                    },
                  ]}
                />
              </Panel>
              <Panel
                title={t('today.forecastTitle')}
                helpKey="overview.today.forecast"
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setTable((v) => !v)} aria-pressed={table}>
                    {table ? t('ui.chart.showChart') : t('ui.chart.showTable')}
                  </Button>
                }
              >
                <p className="mb-3 text-sm text-ink-muted">{t('today.forecastQuestion')}</p>
                <SmallMultiples
                  label={t('today.forecastTitle')}
                  showTable={table}
                  max={1}
                  format={(v) => `${Math.round(v * 100)}%`}
                  series={o.forecast.map((f) => ({
                    id: f.unitTypeName,
                    label: f.unitTypeName,
                    points: f.nights.map((n) => ({
                      x: n.date.slice(8),
                      xLabel: formatLocalDate(n.date, lng, 'short'),
                      value: n.sellable ? n.occupied / n.sellable : 0,
                      detail: `${n.occupied}/${n.sellable}`,
                    })),
                  }))}
                />
              </Panel>
            </>
          );
        })()}
    </div>
  );
}
