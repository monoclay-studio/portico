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
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../../api/errors';
import { useApp } from '../../app/app-context';
import { workspaceSource } from '../../data/sources';
import { PageHeader, Panel } from '../common/page-header';
import { toSimProperty } from '../common/sim-property';
import { SimulatedNote } from '../common/simulated-note';
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
  const query = useQuery({
    queryKey: ['sim', property?.id, property?.businessDate, 'today'],
    queryFn: () => workspaceSource.today(toSimProperty(property as NonNullable<typeof property>)),
    enabled: Boolean(property),
  });
  if (!property) return <EmptyState title={t('app.noProperties')} />;
  const d = query.data?.data;
  const sim = <ProvenanceBadge provenance="simulated" compact />;
  const nf = new Intl.NumberFormat(lng);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('today.title')}
        subtitle={t('today.subtitle', { property: property.name })}
        meta={
          query.data && (
            <ProvenanceBadge provenance={query.data.provenance} lastSyncedAt={query.data.generatedAt} />
          )
        }
        helpKey="overview.today"
      />
      <FirstRunChecklist />
      <SimulatedNote module="reservations + operations + payments" />
      {query.isPending && <SkeletonList rows={6} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'today')}
          onRetry={() => void query.refetch()}
        />
      )}
      {d && (
        <>
          <section
            aria-label={t('today.title')}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {(() => {
              const now = pct(d.occupancy.occupied, d.occupancy.sellable);
              const before = pct(d.occupancy.lastWeek.occupied, d.occupancy.lastWeek.sellable);
              const delta = now - before;
              return (
                <KpiTile
                  label={t('today.occupancy')}
                  icon={<BedDouble />}
                  value={`${now}%`}
                  ratio={d.occupancy.occupied / Math.max(1, d.occupancy.sellable)}
                  counts={{
                    numerator: nf.format(d.occupancy.occupied),
                    denominator: nf.format(d.occupancy.sellable),
                    unit: t('today.villas'),
                  }}
                  annotation={
                    d.occupancy.outOfOrder ? t('today.oooNote', { count: d.occupancy.outOfOrder }) : undefined
                  }
                  delta={{
                    label: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts`,
                    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
                    goodWhen: 'up',
                    period: t('today.vsLastWeek'),
                  }}
                  definition={t('today.occupancyDef')}
                  provenance={sim}
                  onOpen={() => void navigate({ to: '/reservations/timeline' })}
                />
              );
            })()}
            <KpiTile
              label={t('today.arrivals')}
              icon={<ConciergeBell />}
              value={nf.format(d.arrivals.total)}
              ratio={(d.arrivals.ready + d.arrivals.checkedIn) / Math.max(1, d.arrivals.total)}
              counts={{
                numerator: d.arrivals.ready + d.arrivals.checkedIn,
                denominator: d.arrivals.total,
                unit: t('today.readyOf'),
              }}
              delta={{
                label: `${d.arrivals.total - d.arrivals.lastWeek >= 0 ? '+' : '−'}${Math.abs(d.arrivals.total - d.arrivals.lastWeek)}`,
                direction:
                  d.arrivals.total > d.arrivals.lastWeek
                    ? 'up'
                    : d.arrivals.total < d.arrivals.lastWeek
                      ? 'down'
                      : 'flat',
                goodWhen: 'up',
                period: t('today.vsLastWeek'),
              }}
              definition={t('today.arrivalsDef')}
              provenance={sim}
              onOpen={() => void navigate({ to: '/front-desk/arrivals' })}
            />
            <KpiTile
              label={t('today.departures')}
              icon={<LogOut />}
              value={nf.format(d.departures.total)}
              ratio={d.departures.checkedOut / Math.max(1, d.departures.total)}
              counts={{
                numerator: d.departures.checkedOut,
                denominator: d.departures.total,
                unit: t('today.checkedOut'),
              }}
              definition={t('today.departuresDef')}
              provenance={sim}
            />
            <KpiTile
              label={t('today.inHouse')}
              icon={<DoorClosed />}
              value={nf.format(d.inHouse.units)}
              annotation={t('today.guests', { count: d.inHouse.guests })}
              definition={t('today.inHouseDef')}
              provenance={sim}
              onOpen={() => void navigate({ to: '/housekeeping' })}
            />
            <KpiTile
              label={t('today.exceptions')}
              icon={<CircleAlert />}
              value={nf.format(d.exceptions.open)}
              annotation={t('today.urgent', { count: d.exceptions.urgent })}
              delta={{
                label: `${d.exceptions.open - d.exceptions.yesterday >= 0 ? '+' : '−'}${Math.abs(d.exceptions.open - d.exceptions.yesterday)}`,
                direction:
                  d.exceptions.open > d.exceptions.yesterday
                    ? 'up'
                    : d.exceptions.open < d.exceptions.yesterday
                      ? 'down'
                      : 'flat',
                goodWhen: 'down',
                period: t('today.vsYesterday'),
              }}
              definition={t('today.exceptionsDef')}
              provenance={sim}
              tone={d.exceptions.urgent > 0 ? 'attention' : 'default'}
              onOpen={() => void navigate({ to: '/my-work' })}
            />
            <KpiTile
              label={t('today.pending')}
              icon={<Hourglass />}
              value={nf.format(d.pendingVerification.count)}
              annotation={t('today.pendingAmount', {
                amount: formatMoney(d.pendingVerification.amount, lng),
              })}
              definition={t('today.pendingDef')}
              provenance={sim}
              tone={d.pendingVerification.count > 0 ? 'attention' : 'default'}
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
                  value: d.arrivals.checkedIn,
                  kind: 'neutral',
                  icon: <DoorClosed />,
                },
                {
                  id: 'ready',
                  label: t('today.ready'),
                  value: d.arrivals.ready - d.arrivals.attention,
                  kind: 'good',
                  icon: <CircleCheck />,
                },
                {
                  id: 'attention',
                  label: t('today.attention'),
                  value: d.arrivals.attention,
                  kind: 'warning',
                  icon: <TriangleAlert />,
                },
                {
                  id: 'blocked',
                  label: t('today.blocked'),
                  value: d.arrivals.blocked,
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
              series={d.forecast.map((f) => ({
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
      )}
    </div>
  );
}
