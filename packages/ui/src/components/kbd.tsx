import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Kbd({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'inverse' }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-sm border px-1 font-mono text-[0.6875rem] leading-4',
        tone === 'inverse'
          ? 'border-ink-subtle/40 text-ink-inverse'
          : 'border-line-strong bg-surface-muted text-ink-muted',
      )}
    >
      {children}
    </kbd>
  );
}
