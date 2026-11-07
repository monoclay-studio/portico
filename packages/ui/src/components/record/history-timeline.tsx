import { History } from 'lucide-react';
import { formatRelative } from '../../lib/format';
import { useUi } from '../../provider';
import { fmt } from '../../strings';
import { SkeletonList } from '../skeleton';
import type { HistoryEntry, HistoryState } from './types';

function changedFields(e: HistoryEntry): string[] {
  if (!e.before || !e.after || typeof e.before !== 'object' || typeof e.after !== 'object') return [];
  const b = e.before as Record<string, unknown>;
  const a = e.after as Record<string, unknown>;
  return Object.keys(a).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && !['version', 'updatedAt'].includes(k),
  );
}

/** One timeline of what happened to a record, by whom and why (audit log, across modules). Newest first. */
export function HistoryTimeline({
  history,
  now,
  describeAction,
}: {
  history: HistoryState;
  now?: Date;
  /** Turn an audit action key ("platform.property.update") into words. */
  describeAction?: (action: string) => string;
}) {
  const { strings, locale } = useUi();
  const s = strings.record;
  if (history.state === 'loading') return <SkeletonList rows={3} />;
  if (history.state === 'unavailable')
    return <p className="text-sm text-ink-muted">{s.historyUnavailable}</p>;
  if (history.state === 'error') return <p className="text-sm text-danger-fg">{history.message}</p>;
  if (history.items.length === 0) return <p className="text-sm text-ink-muted">{s.historyEmpty}</p>;
  const items = [...history.items].reverse();
  return (
    <ol className="flex flex-col" aria-label={s.history}>
      {items.map((e, i) => {
        const changed = changedFields(e);
        return (
          <li
            key={`${e.at}-${i}`}
            className="relative flex gap-3 pb-3 last:pb-0"
            data-history-action={e.action}
          >
            {i < items.length - 1 && (
              <span aria-hidden className="absolute start-[0.4375rem] top-4 bottom-0 w-px bg-line" />
            )}
            <History aria-hidden className="relative mt-0.5 size-3.5 shrink-0 bg-surface text-ink-muted" />
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <span>
                <span className="font-medium">{describeAction ? describeAction(e.action) : e.action}</span>{' '}
                <span className="text-ink-muted">{fmt(s.by, { actor: e.actor.label })}</span>
              </span>
              <span className="pt-data text-ink-muted normal-case">
                <time dateTime={e.at} title={e.at}>
                  {formatRelative(e.at, now ?? new Date(), locale)}
                </time>
                {changed.length > 0 && ` · ${changed.join(', ')}`}
              </span>
              {e.reason && <span className="text-ink-muted">“{e.reason}”</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
