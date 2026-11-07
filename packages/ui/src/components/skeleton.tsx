import { cn } from '../lib/cn';
import { useUi } from '../provider';

/** Placeholder block while loading. Pulses unless reduced motion is requested. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-[pt-pulse_1.6s_ease-in-out_infinite] rounded-md bg-surface-hover', className)}
    />
  );
}

/** Skeleton rows with an announced loading label. */
export function SkeletonList({ rows = 5, label }: { rows?: number; label?: string }) {
  const { strings } = useUi();
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="pt-sr-only">{label ?? strings.common.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
