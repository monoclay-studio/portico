import { CornerDownLeft, Search } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { Kbd } from './kbd';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Group heading: "Go to", "Actions", "Properties", "Guests"… */
  group: string;
  keywords?: string[];
  description?: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  /** Badge after the label, e.g. a SIMULATED provenance marker on mocked search results. */
  badge?: ReactNode;
  onSelect: () => void;
}

export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
  limit = 60,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.slice(0, limit);
  const words = q.split(/\s+/);
  const scored: Array<{ c: PaletteCommand; score: number; i: number }> = [];
  commands.forEach((c, i) => {
    const label = c.label.toLowerCase();
    const hay = [label, c.group.toLowerCase(), ...(c.keywords ?? []).map((k) => k.toLowerCase())].join(' ');
    if (!words.every((w) => hay.includes(w))) return;
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    scored.push({ c, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
  /** Notified as the user types (for server search). */
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  loading?: boolean;
  /** Footer slot (e.g. provenance legend for search results). */
  footer?: ReactNode;
}

/** Cmd/Ctrl+K palette: jump anywhere, run actions, search records — keyboard first. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onQueryChange,
  placeholder,
  loading,
  footer,
}: CommandPaletteProps) {
  const { strings } = useUi();
  const s = strings.commandPalette;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => rankCommands(commands, query), [commands, query]);
  const groups = useMemo(() => {
    const m = new Map<string, PaletteCommand[]>();
    for (const c of results) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [results]);
  // Flattened order follows the grouped display.
  const ordered = useMemo(() => groups.flatMap(([, cs]) => cs), [groups]);
  const activeCmd = ordered[active];

  const returnTo = useRef<Element | null>(null);
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement;
      setQuery('');
      setActive(0);
    }
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight whenever the query changes
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!activeCmd) return;
    listRef.current
      ?.querySelector(`[data-command-id="${CSS.escape(activeCmd.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeCmd]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // Run after the dialog closes so focus can move to the destination.
    setTimeout(c.onSelect, 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (ordered.length ? (i + 1) % ordered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (ordered.length ? (i - 1 + ordered.length) % ordered.length : 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, ordered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(activeCmd);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            // Return focus where it was (a command that navigates moves focus itself afterwards).
            e.preventDefault();
            const t = returnTo.current;
            if (t instanceof HTMLElement && t.isConnected) t.focus();
          }}
          className="fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-lg"
        >
          <DialogPrimitive.Title className="pt-sr-only">{s.title}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search aria-hidden className="size-5 text-ink-subtle" />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeCmd ? `${listId}-${activeCmd.id}` : undefined}
              aria-label={s.title}
              aria-busy={loading || undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder ?? s.placeholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onQueryChange?.(e.target.value);
              }}
              onKeyDown={onKeyDown}
              className="min-h-14 flex-1 bg-transparent text-base outline-none placeholder:text-ink-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={s.title}
            className="min-h-0 flex-1 overflow-auto p-2"
          >
            {groups.map(([group, cs]) => {
              const headingId = `${listId}-g-${group.replace(/\W+/g, '-')}`;
              return (
                <div key={group} role="group" aria-labelledby={headingId} className="mb-2">
                  <div
                    id={headingId}
                    role="presentation"
                    className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {group}
                  </div>
                  {cs.map((c) => {
                    const isActive = c === activeCmd;
                    return (
                      <div
                        key={c.id}
                        id={`${listId}-${c.id}`}
                        data-command-id={c.id}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(ordered.indexOf(c))}
                        onClick={() => run(c)}
                        className={cn(
                          'flex min-h-control cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm',
                          isActive && 'bg-accent-soft',
                        )}
                      >
                        {c.icon && (
                          <span aria-hidden className="inline-flex text-ink-muted [&_svg]:size-4">
                            {c.icon}
                          </span>
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{c.label}</span>
                            {c.badge}
                          </span>
                          {c.description && (
                            <span className="truncate text-xs text-ink-muted">{c.description}</span>
                          )}
                        </span>
                        {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
                        {isActive && (
                          <CornerDownLeft aria-hidden className="size-4 text-ink-subtle rtl:-scale-x-100" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {ordered.length === 0 && (
              <p role="status" className="px-3 py-6 text-center text-sm text-ink-muted">
                {loading ? strings.common.loading : s.noResults}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-muted">
            <span>{s.hint}</span>
            {footer}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
