import { CloudOff, WifiOff } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/format';
import { useOnlineStatus } from '../lib/hooks';
import { useUi } from '../provider';
import { fmt } from '../strings';

export interface OfflineIndicatorProps {
  /** Override detection (tests, or API health from the app). */
  online?: boolean;
  /** Browser online but the API is not reachable. */
  apiReachable?: boolean;
  /** When the data on screen was last refreshed (ISO). */
  lastUpdatedAt?: string | undefined;
  timeZone?: string;
  className?: string;
}

/**
 * Connectivity status. Says what is stale and that changes cannot be saved — never implies offline data is
 * current (brief §16). Renders nothing while everything is reachable.
 */
export function OfflineIndicator({
  online: onlineProp,
  apiReachable = true,
  lastUpdatedAt,
  timeZone = 'UTC',
  className,
}: OfflineIndicatorProps) {
  const { strings, locale } = useUi();
  const detected = useOnlineStatus();
  const online = onlineProp ?? detected;
  if (online && apiReachable) return <span role="status" aria-live="polite" className="pt-sr-only" />;
  const offline = !online;
  const detail = offline
    ? lastUpdatedAt
      ? fmt(strings.offline.offlineDetail, { time: formatTime(lastUpdatedAt, timeZone, locale) })
      : strings.offline.offlineDetailNoTime
    : strings.offline.apiUnreachableDetail;
  const Icon = offline ? WifiOff : CloudOff;
  return (
    <div
      role="status"
      aria-live="polite"
      data-offline={offline ? 'browser' : 'api'}
      className={cn(
        'flex items-start gap-2 rounded-md border border-warning-line bg-warning-bg px-3 py-2 text-sm text-ink',
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-fg" />
      <p>
        <span className="font-semibold">
          {offline ? strings.offline.offline : strings.offline.apiUnreachable}.{' '}
        </span>
        {detail}
      </p>
    </div>
  );
}
