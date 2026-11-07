import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * The "data voice": monospace, uppercase, tabular annotations for counts and identifiers ("96 OF 120 VILLAS").
 * Keeps data visually distinct from UI text and controls.
 */
export function DataText({
  children,
  className,
  as: As = 'span',
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'p';
}) {
  return <As className={cn('pt-data text-ink-muted', className)}>{children}</As>;
}

/** Codes and IDs inline (booking codes, unit numbers, amounts in tables): monospace, original case. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('pt-code', className)}>{children}</span>;
}
