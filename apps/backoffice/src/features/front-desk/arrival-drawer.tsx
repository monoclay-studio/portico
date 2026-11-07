import { Button, Drawer, formatLocalDate, formatMoney, formatTime, ProvenanceBadge, StatusBadge, StepTracker, useToast } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { CalendarRange, CircleCheck, CircleX, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Property } from '../../api';
import type { ArrivalRow } from '../../mocks/contracts';
import { Facts } from '../common/page-header';
import { ExtendStayDialog } from '../reservations/extend-stay-dialog';
import { ReadinessChecks } from './readiness';

/**
 * One arrival: state, outstanding issues, owner, next action, history of the check-in workflow (brief §3:
 * every important record shows current state, history, issues, owner and next actions).
 */
export function ArrivalDrawer({ row, property, onClose }: { row: ArrivalRow; property: Property; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [extendOpen, setExtendOpen] = useState(false);
  const lng = i18n.resolvedLanguage;
  const d = row.arrivalDetails;
  const b = row.readiness.blockingReason;
  return (
    <>
      <Drawer
        open
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        title={t('arrivals.openArrival', { guest: row.guestName })}
        description={`${row.bookingCode} · ${row.unitName ?? t('arrivals.unassigned')} · ${row.unitTypeName}`}
        meta={
          <>
            <StatusBadge vocabulary="booking" value={row.bookingStatus} />
            <StatusBadge vocabulary="stay" value={row.stayStatus} />
            <StatusBadge vocabulary="payment" value={row.paymentStatus} />
            {row.unitCondition && <StatusBadge vocabulary="condition" value={row.unitCondition} />}
            <ProvenanceBadge provenance="simulated" compact />
          </>
        }
        footer={
          <>
            <Button asChild variant="ghost" icon={<CalendarRange />}>
              <Link to="/reservations/timeline" search={{ stay: row.stayId }}>
                {t('arrivals.timelineLink')}
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => setExtendOpen(true)}>
              {t('arrivals.extendStay')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {b ? (
            <div role="note" className="flex items-start gap-3 rounded-md border border-danger-line border-s-4 border-s-danger-solid bg-danger-bg p-3">
              <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-danger-fg" />
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold">
                  {t('arrivals.blocker')}: {t(`arrivals.checkKeys.${b.key}`)}
                </span>
                <span>{b.message}</span>
                {b.owner && (
                  <span className="flex items-center gap-1 text-xs text-ink-muted">
                    <UserRound aria-hidden className="size-3.5" />
                    {t('arrivals.nextActionFor', { owner: b.owner })}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div role="note" className="flex items-center gap-3 rounded-md border border-success-line bg-success-bg p-3 text-sm">
              <CircleCheck aria-hidden className="size-5 text-success-fg" />
              <span className="font-semibold">{t('arrivals.noBlocker')}</span>
            </div>
          )}

          <section aria-labelledby="checks-h" className="flex flex-col gap-2">
            <h3 id="checks-h" className="text-sm font-semibold">
              {t('arrivals.checks')}
            </h3>
            <ReadinessChecks checks={row.readiness.checks} />
          </section>

          {row.checkInRun && (
            <StepTracker
              title={t('arrivals.checkInProgress')}
              steps={row.checkInRun.steps}
              onResume={() => toast({ tone: 'pending', title: t('arrivals.resumed'), description: t('arrivals.checkInResumeNote') })}
            />
          )}

          <section aria-labelledby="arrival-h" className="flex flex-col gap-2">
            <h3 id="arrival-h" className="text-sm font-semibold">
              {t('arrivals.arrivalDetails')}
            </h3>
            <Facts
              items={[
                [t('arrivals.transport'), `${t(`arrivals.transportModes.${d.transportMode}`)}${d.carrier ? ` · ${d.carrier}` : ''}${d.number ? ` ${d.number}` : ''}`],
                [t('arrivals.inbound'), d.inbound ?? '—'],
                [
                  t('arrivals.eta'),
                  <span key="eta" className="pt-tabular">
                    {d.scheduledAt ? `${formatTime(d.scheduledAt, property.timezone, lng)} ${t('arrivals.scheduled')}` : '—'}
                    {d.estimatedAt && d.estimatedAt !== d.scheduledAt && (
                      <span className="ms-2 font-medium text-warning-fg">
                        → {formatTime(d.estimatedAt, property.timezone, lng)} ({t('arrivals.estimated')})
                      </span>
                    )}
                  </span>,
                ],
                [t('arrivals.arrivalPoint'), d.arrivalPoint ?? '—'],
              ]}
            />
          </section>

          <section aria-labelledby="stay-h" className="flex flex-col gap-2">
            <h3 id="stay-h" className="text-sm font-semibold">
              {t('arrivals.stayDetails')}
            </h3>
            <Facts
              items={[
                [t('arrivals.villa'), `${row.unitName ?? t('arrivals.unassigned')} · ${row.unitTypeName}`],
                [
                  t('arrivals.nights'),
                  `${formatLocalDate(row.arrival, lng, 'short')} → ${formatLocalDate(row.departure, lng, 'short')} · ${row.nights}`,
                ],
                [
                  t('arrivals.occupancy'),
                  [t('arrivals.adults', { count: row.occupancy.adults }), row.occupancy.childrenAges.length ? t('arrivals.children', { count: row.occupancy.childrenAges.length }) : '']
                    .filter(Boolean)
                    .join(', '),
                ],
                [t('arrivals.balance'), <span key="bal" className="pt-tabular">{formatMoney(row.balance, lng)}</span>],
                [t('arrivals.requests'), row.requests.length ? row.requests.join(' · ') : t('arrivals.noRequests')],
                [t('arrivals.owner'), row.owner ?? '—'],
              ]}
            />
          </section>
        </div>
      </Drawer>
      {extendOpen && <ExtendStayDialog property={property} stayId={row.stayId} open={extendOpen} onOpenChange={setExtendOpen} />}
    </>
  );
}
