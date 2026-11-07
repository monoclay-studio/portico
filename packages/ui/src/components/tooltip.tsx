import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { Kbd } from './kbd';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  shortcut?: string | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Supplementary hint on hover and keyboard focus (WCAG 1.4.13: dismissible with Esc, hoverable, persistent).
 * Never put essential information only in a tooltip.
 */
export function Tooltip({ content, children, shortcut, side = 'top' }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-md bg-surface-inverse px-2 py-1 text-xs text-ink-inverse shadow-md"
        >
          <span className="inline-flex items-center gap-2">
            {content}
            {shortcut && <Kbd tone="inverse">{shortcut}</Kbd>}
          </span>
          <TooltipPrimitive.Arrow className="fill-surface-inverse" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
