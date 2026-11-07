import { ChevronRight, Maximize2, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
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
}) {
  const { strings } = useUi();
  const s = strings.record;
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onBack()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-record-drawer
          onPointerDownOutside={(e) => {
            e.preventDefault();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey && onOpenFullPage) {
              e.preventDefault();
              onOpenFullPage();
            }
          }}
          className="fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-surface text-ink shadow-lg data-[state=open]:animate-[pt-slide-in-end_180ms_var(--pt-ease)] sm:max-w-xl lg:max-w-2xl"
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
                      {!last && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-subtle rtl:rotate-180" />}
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
            <IconButton size="sm" label={strings.common.close} icon={<X />} onClick={onClose} tooltip={false} />
          </div>
          <DialogPrimitive.Title className="pt-sr-only">{title}</DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{loading ? <SkeletonList rows={6} /> : children}</div>
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
