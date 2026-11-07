import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { IconButton } from './button';

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement;
  title: ReactNode;
  /** One-sentence summary announced with the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions (right-aligned in LTR, left in RTL). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing by clicking outside — for dialogs holding unsaved input. Esc still works. */
  modalStrict?: boolean;
  className?: string;
  /** Tone of the header — e.g. 'warning' for conflicts. Adds an icon slot. */
  icon?: ReactNode;
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** Modal dialog: focus trapped, Esc closes, focus returns to the trigger, background inert. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = 'md',
  modalStrict,
  className,
  icon,
}: DialogProps) {
  const { strings } = useUi();
  return (
    <DialogPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[pt-fade-in_150ms]" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onPointerDownOutside={modalStrict ? (e) => e.preventDefault() : undefined}
          className={cn(
            'fixed inset-x-0 top-[8vh] z-50 mx-auto flex max-h-[84vh] w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-surface text-ink shadow-lg',
            widths[size],
            className,
          )}
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            {icon && (
              <span aria-hidden className="mt-0.5 inline-flex [&_svg]:size-5">
                {icon}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={strings.common.close} icon={<X />} size="sm" tooltip={false} />
            </DialogPrimitive.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>}
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;
