import { cn } from '@portico/ui';
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  DoorClosed,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReadinessCheck } from '../../data/contracts';
import { type DeskRowView, deskState } from '../../data/front-desk';

const checkIcon = {
  ok: { Icon: CircleCheck, cls: 'text-success-fg' },
  blocking: { Icon: CircleX, cls: 'text-danger-fg' },
  unknown: { Icon: CircleHelp, cls: 'text-pending-fg' },
} as const;
const iconFor = (status: string) => checkIcon[status as keyof typeof checkIcon] ?? checkIcon.unknown;

/**
 * Board cell: the single blocker in full (two lines, never only in a tooltip) with who acts on it; or "Ready for
 * check-in"; an in-house stay is "Checked in", never "Ready" (C3.2).
 */
export function ReadinessCell({ row, wrap }: { row: DeskRowView; wrap?: boolean }) {
  const { t } = useTranslation();
  const state = deskState(row);
  if (state === 'checked_in' || state === 'in_house')
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
        <DoorClosed aria-hidden className="size-4 shrink-0" />
        {t('desk.checkedIn')}
      </span>
    );
  if (state === 'ready')
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <CircleCheck aria-hidden className="size-4 shrink-0 text-success-fg" />
        <span className="font-medium text-success-fg">{t('arrivals.noBlocker')}</span>
      </span>
    );
  const b = row.blocker;
  if (!b)
    return (
      <span className="flex items-center gap-1.5 text-sm text-pending-fg">
        <CircleHelp aria-hidden className="size-4 shrink-0" />
        {t('desk.readinessUnknown')}
      </span>
    );
  const { Icon, cls } = iconFor(b.status);
  const owner = [b.owner.name, t(`desk.departments.${b.owner.department}`)].filter(Boolean).join(' · ');
  return (
    <span className="flex min-w-0 items-start gap-1.5 text-sm leading-snug" data-blocker={b.key}>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', cls)} />
      <span className="flex min-w-0 flex-col">
        <span className="pt-sr-only">{t('arrivals.blocker')}: </span>
        <span className={cn('font-medium', !wrap && 'line-clamp-2')}>{b.message}</span>
        <span className="truncate text-xs text-ink-muted">{t('desk.nextBy', { owner })}</span>
      </span>
    </span>
  );
}

/** "Secured" (FD-03): the payment_secured check — a different question from the balance and from "Paid". */
export function SecuredCell({ check }: { check: ReadinessCheck | null }) {
  const { t } = useTranslation();
  if (!check) return null;
  const Icon =
    check.status === 'ok' ? ShieldCheck : check.status === 'blocking' ? ShieldAlert : ShieldQuestion;
  const cls =
    check.status === 'ok'
      ? 'text-success-fg'
      : check.status === 'blocking'
        ? 'text-danger-fg'
        : 'text-pending-fg';
  return (
    <span className="flex max-w-full items-center gap-1 text-xs" title={check.message}>
      <Icon aria-hidden className={cn('size-3.5 shrink-0', cls)} />
      <span className="truncate">
        {check.status === 'ok'
          ? t('desk.securedOk')
          : check.status === 'blocking'
            ? t('desk.securedNo')
            : t('desk.securedUnknown')}
      </span>
    </span>
  );
}

export function ReadinessChecks({ checks }: { checks: readonly ReadinessCheck[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((c) => {
        const { Icon, cls } = iconFor(c.status);
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
                {t(`arrivals.checkKeys.${c.key}`, { defaultValue: c.key.replace(/_/g, ' ') })}{' '}
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
