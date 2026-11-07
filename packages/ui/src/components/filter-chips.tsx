import { Bookmark, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Active filters as removable chips, plus the saved view name — context is always visible and editable. */
export function FilterChips({
  chips,
  viewName,
  modified,
  onClearAll,
  className,
}: {
  chips: readonly FilterChip[];
  viewName?: string | undefined;
  modified?: boolean;
  onClearAll?: () => void;
  className?: string;
}) {
  const { strings } = useUi();
  if (!viewName && chips.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {viewName && (
        <li className="inline-flex items-center gap-1 text-xs text-ink-muted">
          <Bookmark aria-hidden className="size-3.5" />
          <span>
            {strings.chips.view}: <span className="font-medium text-ink">{viewName}</span>
            {modified ? ' *' : ''}
          </span>
        </li>
      )}
      {chips.map((c) => (
        <li key={c.id}>
          <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line-strong bg-surface ps-2.5 text-xs text-ink">
            {c.label}
            <button
              type="button"
              aria-label={fmt(strings.chips.remove, { label: c.label })}
              onClick={c.onRemove}
              className="inline-flex size-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        </li>
      ))}
      {chips.length > 1 && onClearAll && (
        <li>
          <button type="button" onClick={onClearAll} className="min-h-7 px-1 text-xs font-medium text-accent underline underline-offset-2">
            {strings.chips.clearAll}
          </button>
        </li>
      )}
    </ul>
  );
}
