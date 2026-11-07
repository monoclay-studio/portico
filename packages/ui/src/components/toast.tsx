import { CheckCircle2, Clock3, Info, X, XCircle } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { isApplePlatform } from '../lib/hooks';
import { useUi } from '../provider';
import { fmt } from '../strings';

export type ToastTone = 'success' | 'error' | 'info' | 'pending';

export interface ToastInput {
  title: string;
  description?: ReactNode;
  tone?: ToastTone;
  /** Optional action, e.g. "Undo" or "Open booking". Needs an alt text describing an alternative way to do it. */
  action?: { label: string; altText: string; onClick: () => void };
  /** Correlation/reference id for support. */
  reference?: string;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="text-success-fg" />,
  error: <XCircle className="text-danger-fg" />,
  info: <Info className="text-info-fg" />,
  pending: <Clock3 className="text-pending-fg" />,
};

const toneBorder: Record<ToastTone, string> = {
  success: 'border-s-success-solid',
  error: 'border-s-danger-solid',
  info: 'border-s-info-solid',
  pending: 'border-s-pending-solid',
};

/**
 * Toast host. Errors and pending outcomes never auto-dismiss (a failed action must not quietly disappear);
 * successes dismiss after 6 s and stay reachable with F8.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const { strings } = useUi();
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: ToastInput) => {
    setItems((list) => [...list.slice(-4), { ...t, id: Date.now() + Math.random() }]);
  }, []);
  const remove = (id: number) => setItems((list) => list.filter((i) => i.id !== id));
  const hotkey = isApplePlatform() ? 'F8' : 'F8';
  return (
    <ToastContext.Provider value={push}>
      {children}
      {items.map((t) => {
        const tone = t.tone ?? 'info';
        const sticky = tone === 'error' || tone === 'pending';
        return (
          <ToastPrimitive.Root
            key={t.id}
            type={tone === 'error' ? 'foreground' : 'background'}
            {...(sticky ? { duration: Number.POSITIVE_INFINITY } : {})}
            onOpenChange={(o) => !o && remove(t.id)}
            className={cn(
              'flex w-full items-start gap-3 rounded-md border border-line border-s-4 bg-surface p-3 text-ink shadow-lg',
              toneBorder[tone],
            )}
          >
            <span aria-hidden className="mt-0.5 inline-flex [&_svg]:size-5">
              {toneIcon[tone]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-sm text-ink-muted">
                  {t.description}
                </ToastPrimitive.Description>
              )}
              {t.reference && (
                <span className="font-mono text-xs text-ink-muted">
                  {strings.problem.reference}: {t.reference}
                </span>
              )}
              {t.action && (
                <ToastPrimitive.Action
                  altText={t.action.altText}
                  onClick={t.action.onClick}
                  className="mt-1 self-start text-sm font-medium text-accent underline underline-offset-2"
                >
                  {t.action.label}
                </ToastPrimitive.Action>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label={strings.common.close}
              className="inline-flex size-control-sm items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover"
            >
              <X aria-hidden className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport
        label={fmt(strings.toast.region, { hotkey })}
        className="fixed bottom-0 end-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none"
      />
    </ToastContext.Provider>
  );
}

/** Show a toast. Must be inside <Toaster>. */
export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  return useMemo(
    () =>
      ctx ??
      (() => {
        throw new Error('useToast must be used inside <Toaster>');
      }),
    [ctx],
  );
}
