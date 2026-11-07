import { HoverCard } from 'radix-ui';
import { type ReactNode, useContext, useState } from 'react';
import { cn } from '../../lib/cn';
import { GridCellContext } from '../data-table/data-table';
import { Skeleton } from '../skeleton';
import { humanizeCode, StatusBadge, vocabularyForFamily } from '../status-badge';
import type { RecordSummary } from './types';

/**
 * Link to any record with a hover/focus preview (GET /v1/records/:type/:id/summary), so people stop navigating
 * just to check a simple fact. Activating it opens the record drawer.
 */
export function EntityLink({
  type,
  id,
  children,
  loadSummary,
  onOpen,
  badge,
  className,
}: {
  type: string;
  id: string;
  children: ReactNode;
  loadSummary: (type: string, id: string) => Promise<RecordSummary | null>;
  onOpen: (type: string, id: string) => void;
  /** e.g. a SIMULATED provenance marker for mocked records. */
  badge?: ReactNode;
  className?: string;
}) {
  const [summary, setSummary] = useState<RecordSummary | null | undefined>(undefined);
  // Inside a data grid the cell is the tab stop (Enter on the row opens it); the link stays clickable.
  const inGridCell = useContext(GridCellContext);
  const load = () => {
    if (summary !== undefined) return;
    loadSummary(type, id).then(setSummary, () => setSummary(null));
  };
  return (
    <HoverCard.Root openDelay={350} closeDelay={120} onOpenChange={(o) => o && load()}>
      <HoverCard.Trigger asChild>
        <a
          href={`?record=${encodeURIComponent(`${type}:${id}`)}`}
          data-entity-link={`${type}:${id}`}
          {...(inGridCell ? { tabIndex: -1 } : {})}
          onFocus={load}
          onClick={(e) => {
            e.preventDefault();
            // A link inside a clickable row opens this record, not the row's.
            e.stopPropagation();
            onOpen(type, id);
          }}
          className={cn(
            'font-medium text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent',
            className,
          )}
        >
          {children}
        </a>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] w-72 rounded-md border border-line bg-surface p-3 text-sm text-ink shadow-md"
        >
          {summary === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : summary === null ? (
            <p className="text-ink-muted">—</p>
          ) : (
            <div className="flex flex-col gap-1.5" data-entity-preview>
              <span className="pt-data text-ink-muted">{summary.label ?? summary.type}</span>
              <span className="flex items-center gap-2 font-semibold">
                {summary.title}
                {badge}
              </span>
              {summary.subtitle && <span className="text-ink-muted">{summary.subtitle}</span>}
              {summary.status && (
                <span className="flex flex-wrap gap-1">
                  {Object.entries(summary.status).map(([family, value]) => {
                    const vocabulary = vocabularyForFamily(family);
                    return vocabulary ? (
                      <StatusBadge key={family} vocabulary={vocabulary} value={value} />
                    ) : (
                      <span
                        key={family}
                        className="rounded-sm border border-neutral-line px-1.5 text-xs text-neutral-fg"
                      >
                        {humanizeCode(family)}: {humanizeCode(value)}
                      </span>
                    );
                  })}
                </span>
              )}
            </div>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
