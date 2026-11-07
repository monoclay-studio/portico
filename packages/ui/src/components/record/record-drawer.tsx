import { ChevronRight, Maximize2, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useUi } from '../../provider';
import { IconButton } from '../button';
import { SkeletonList } from '../skeleton';

export interface RecordTrailItem {
  key: string;
  title: string;
}

/**
 * Record drawer over the current screen (experience architecture §2): breadcrumb trail of records opened from
 * one another, Esc goes back one step (and closes at the first), "Open full page" is one click/key away.
 * The screen underneath stays mounted, so its filters and scroll position are preserved.
 */
export function RecordDrawer({
  trail,
  onNavigateTrail,
  onBack,
  onClose,
  onOpenFullPage,
  children,
  loading,
  title,
  mode = 'panel',
  recordKey,
}: {
  trail: readonly RecordTrailItem[];
  /** Jump to a breadcrumb (index into trail). */
  onNavigateTrail: (index: number) => void;
  /** Esc: one step back (closes when there is nothing behind). */
  onBack: () => void;
  onClose: () => void;
  onOpenFullPage?: (() => void) | undefined;
  children: ReactNode;
  loading?: boolean;
  title: string;
  /**
   * `panel` (default): non-modal side panel — no scrim, the list beside it stays usable, so the next record is
   * one key away (j/k). `modal`: a scrim and a focus trap, for narrow screens.
   */
  mode?: 'panel' | 'modal';
  /** Key of the record shown; when it changes, focus moves to the new record. */
  recordKey?: string;
}) {
  const { strings } = useUi();
  const s = strings.record;
  const bodyRef = useRef<HTMLElement>(null);
  // Where focus was before the drawer opened: it goes back there on close (WCAG 2.4.3).
  const returnTo = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const modal = mode === 'modal';
  // Another record shown in the same panel: start at its top; keep focus inside if it was there.
  useEffect(() => {
    if (recordKey === undefined) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = 0;
    if (document.activeElement === document.body) body.focus();
  }, [recordKey]);
  return (
    <DialogPrimitive.Root open modal={modal} onOpenChange={(o) => !o && onBack()}>
      <DialogPrimitive.Portal>
        {modal && <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-record-drawer
          data-mode={mode}
          onOpenAutoFocus={(e) => {
            // Land on the record itself (not the first toolbar button, whose tooltip would swallow the first Esc).
            e.preventDefault();
            bodyRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // If the person already moved on (e.g. focus is back in the list), leave focus where it is.
            const active = document.activeElement;
            const inDrawer = active === document.body || Boolean(active?.closest('[data-record-drawer]'));
            const target = returnTo.current;
            if (inDrawer && target instanceof HTMLElement && target.isConnected) target.focus();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            // In panel mode a click on the list beside it opens another record; only modal mode closes on outside.
            if (modal) onClose();
          }}
          onFocusOutside={(e) => {
            if (!modal) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!modal) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey && onOpenFullPage) {
              e.preventDefault();
              onOpenFullPage();
            }
          }}
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-surface text-ink shadow-lg data-[state=open]:animate-[pt-slide-in-end_180ms_var(--pt-ease)]',
            // min(560px, 100vw − 48px), Close always inside the viewport; full-screen sheet on phones (C4.4).
            'sm:w-[min(560px,calc(100vw_-_48px))]',
          )}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <nav aria-label={s.breadcrumb} className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1 text-xs">
                {trail.map((t, i) => {
                  const last = i === trail.length - 1;
                  return (
                    <li key={t.key} className={cn('flex min-w-0 items-center gap-1', !last && 'shrink')}>
                      {last ? (
                        <span aria-current="page" className="truncate font-medium text-ink">
                          {t.title}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigateTrail(i)}
                          className="min-h-7 truncate rounded-sm px-1 text-accent underline-offset-2 hover:underline"
                        >
                          {t.title}
                        </button>
                      )}
                      {!last && (
                        <ChevronRight
                          aria-hidden
                          className="size-3.5 shrink-0 text-ink-subtle rtl:rotate-180"
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            {onOpenFullPage && (
              <IconButton
                size="sm"
                label={s.openFullPage}
                shortcut="Shift Enter"
                icon={<Maximize2 />}
                onClick={onOpenFullPage}
              />
            )}
            <IconButton
              size="sm"
              label={strings.common.close}
              icon={<X />}
              onClick={onClose}
              tooltip={false}
            />
          </div>
          {/* The dialog's accessible name; the visible record heading inside stays the only heading. */}
          <DialogPrimitive.Title asChild>
            <span className="pt-sr-only">{title}</span>
          </DialogPrimitive.Title>
          <section
            ref={bodyRef}
            tabIndex={-1}
            data-record-body
            aria-label={title}
            className="min-h-0 flex-1 overflow-auto px-5 py-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
          >
            {loading ? <SkeletonList rows={6} /> : children}
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Full-page record template: same anatomy at page width, with a back link. */
export function RecordPage({ back, children }: { back?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {back}
      <div className="rounded-lg border border-line bg-surface p-5">{children}</div>
    </div>
  );
}
