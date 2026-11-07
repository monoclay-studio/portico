import { cn } from '@portico/ui';
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ArrivalRow, ReadinessCheck } from '../../mocks/contracts';

const checkIcon = {
  ok: { Icon: CircleCheck, cls: 'text-success-fg' },
  blocking: { Icon: CircleX, cls: 'text-danger-fg' },
  attention: { Icon: TriangleAlert, cls: 'text-warning-fg' },
  unknown: { Icon: CircleHelp, cls: 'text-pending-fg' },
} as const;

/** Board cell: either "Ready for check-in" or the single blocker with its owner. */
export function ReadinessCell({ row }: { row: ArrivalRow }) {
  const { t } = useTranslation();
  const r = row.readiness;
  if (r.ready) {
    const attention = r.checks.filter((c) => c.status === 'attention').length;
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-fg" />
        <span className="whitespace-nowrap font-medium text-success-fg">{t('arrivals.noBlocker')}</span>
        {attention > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-warning-fg">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{r.checks.find((c) => c.status === 'attention')?.message}</span>
          </span>
        )}
      </span>
    );
  }
  const b = r.blockingReason;
  const unknown = r.checks.find((c) => c.key === b?.key)?.status === 'unknown';
  const { Icon, cls } = unknown ? checkIcon.unknown : checkIcon.blocking;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm" title={b?.message}>
      <Icon aria-hidden className={cn('size-4 shrink-0', cls)} />
      <span className="pt-sr-only">{t('arrivals.blocker')}: </span>
      <span className="truncate">{b?.message}</span>
    </span>
  );
}

export function ReadinessChecks({ checks }: { checks: readonly ReadinessCheck[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((c) => {
        const { Icon, cls } = checkIcon[c.status];
        return (
          <li
            key={c.key}
            className="flex items-start gap-2 text-sm"
            data-check={c.key}
            data-check-status={c.status}
          >
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', cls)} />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">
                {t(`arrivals.checkKeys.${c.key}`)}{' '}
                <span className={cn('text-xs font-medium', cls)}>
                  · {t(`arrivals.checkStatus.${c.status}`)}
                </span>
              </span>
              <span className="text-ink-muted">{c.message}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
