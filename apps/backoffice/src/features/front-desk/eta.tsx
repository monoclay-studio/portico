import { formatTime } from '@portico/ui';
import { Clock3, Plane, Sailboat } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ArrivalRow } from '../../mocks/contracts';

export function EtaCell({ row, timeZone }: { row: ArrivalRow; timeZone: string }) {
  const { t, i18n } = useTranslation();
  const d = row.arrivalDetails;
  const Icon = d.transportMode === 'speedboat' ? Sailboat : Plane;
  const delayMin =
    d.scheduledAt && d.estimatedAt ? Math.round((new Date(d.estimatedAt).getTime() - new Date(d.scheduledAt).getTime()) / 60_000) : 0;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="pt-tabular flex items-center gap-1.5 font-medium">
        <Icon aria-hidden className="size-3.5 text-ink-muted" />
        {row.eta ? formatTime(row.eta, timeZone, i18n.resolvedLanguage) : '—'}
        <span className="pt-sr-only">{t(`arrivals.transportModes.${d.transportMode}`)}</span>
      </span>
      {delayMin > 0 ? (
        <span className="flex items-center gap-1 text-xs font-medium text-warning-fg">
          <Clock3 aria-hidden className="size-3" />
          {t('arrivals.delayedBy', { minutes: delayMin })}
        </span>
      ) : (
        <span className="truncate text-xs text-ink-muted">{t(`arrivals.transportModes.${d.transportMode}`)}</span>
      )}
    </span>
  );
}
