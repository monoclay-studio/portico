import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { IconButton } from './button';

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Header slot under the title — status badges, provenance. */
  meta?: ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Side sheet anchored to the inline end (right in LTR, left in RTL). Keeps the list behind it in context —
 * use for record details opened from boards and tables.
 */
export function Drawer({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  meta,
  size = 'md',
}: DrawerProps) {
  const { strings } = useUi();
  return (
    <DialogPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-surface text-ink shadow-lg',
            'data-[state=open]:animate-[pt-slide-in-end_180ms_var(--pt-ease)]',
            size === 'md' ? 'sm:max-w-md' : 'sm:max-w-2xl',
          )}
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
              {meta && <div className="mt-1 flex flex-wrap items-center gap-1.5">{meta}</div>}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={strings.common.close} icon={<X />} size="sm" tooltip={false} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
