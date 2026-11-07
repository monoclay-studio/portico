import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';

export interface KpiDelta {
  /** Formatted signed change, e.g. "+4 pts", "−2". */
  label: string;
  direction: 'up' | 'down' | 'flat';
  /** Whether "up" is good for this metric (occupancy) or bad (exceptions). Decides the tone, never alone. */
  goodWhen: 'up' | 'down';
  /** Comparison period, e.g. "same night last week". */
  period: string;
}

export interface KpiTileProps {
  label: string;
  /** Formatted headline value ("80%", "18", "USD 4,210.00"). Proportional figures at display size. */
  value: string;
  delta?: KpiDelta | undefined;
  /** The raw counts behind the headline — the denominator keeps it honest ("96 of 120 villas"). */
  counts?: { numerator: number | string; denominator: number | string; unit?: string } | undefined;
  /** Optional secondary data line (data voice), e.g. "211 GUESTS". */
  annotation?: ReactNode;
  /** 0–1 share drawn as a thin meter (only when the value IS a ratio against a limit). */
  ratio?: number | undefined;
  /** Metric definition: what is counted, period, source. One click/focus away. */
  definition: ReactNode;
  /** Drill into the records (renders the tile as a link/button). */
  href?: string | undefined;
  onOpen?: (() => void) | undefined;
  /** Attention state for metrics that mean "something needs doing" (icon + text, never colour alone). */
  tone?: 'default' | 'attention';
  icon?: ReactNode;
  /** Provenance slot (e.g. SIMULATED). */
  provenance?: ReactNode;
  className?: string;
}

/**
 * Stat tile: big number + delta vs a named period + the raw counts behind it + a definition, and the whole
 * tile drills into the records. Follows docs/product/design-direction.md.
 */
export function KpiTile({
  label,
  value,
  delta,
  counts,
  annotation,
  ratio,
  definition,
  href,
  onOpen,
  tone = 'default',
  icon,
  provenance,
  className,
}: KpiTileProps) {
  const { strings } = useUi();
  const s = strings.kpi;
  const good = delta && delta.direction !== 'flat' ? delta.direction === delta.goodWhen : null;
  const DeltaIcon =
    delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : ArrowRight;
  const countsText = counts
    ? `${fmt(s.of, { numerator: String(counts.numerator), denominator: String(counts.denominator) })}${counts.unit ? ` ${counts.unit}` : ''}`
    : null;
  const drill = href || onOpen;
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span data-kpi-value className="text-display font-semibold tracking-tight text-ink">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              'pt-data inline-flex items-center gap-0.5 normal-case',
              good === true && 'text-success-fg',
              good === false && 'text-danger-fg',
              good === null && 'text-ink-muted',
            )}
          >
            <DeltaIcon aria-hidden className="size-3.5" />
            <span className="pt-sr-only">{s[delta.direction]} </span>
            {delta.label}
            <span className="pt-sr-only"> {fmt(s.vs, { period: delta.period })}</span>
          </span>
        )}
      </span>
      {ratio !== undefined && (
        <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-viz-seq-track">
          <span
            className="block h-full rounded-full bg-viz-seq"
            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
          />
        </span>
      )}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {countsText && <span className="pt-data text-ink-muted">{countsText}</span>}
        {annotation && <span className="pt-data text-ink-muted">{annotation}</span>}
        {delta && (
          <span className="pt-data text-ink-muted normal-case">{fmt(s.vs, { period: delta.period })}</span>
        )}
      </span>
    </>
  );
  return (
    <div
      data-kpi={label}
      className={cn(
        'relative flex min-w-0 flex-col gap-3 rounded-lg border bg-surface p-4',
        tone === 'attention' ? 'border-warning-line border-s-4 border-s-warning-solid' : 'border-line',
        drill && 'hover:bg-surface-muted',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon && (
          <span
            aria-hidden
            className={cn(
              'inline-flex [&_svg]:size-4',
              tone === 'attention' ? 'text-warning-fg' : 'text-ink-muted',
            )}
          >
            {icon}
          </span>
        )}
        <h3 className="text-sm font-medium text-ink">{label}</h3>
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger
            aria-label={fmt(s.definition, { metric: label })}
            className="relative z-10 inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            <Info aria-hidden className="size-3.5" />
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={8}
              className="z-50 max-w-xs rounded-md border border-line bg-surface p-3 text-sm text-ink shadow-md"
            >
              {definition}
              <PopoverPrimitive.Arrow className="fill-surface" />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        <span className="ms-auto">{provenance}</span>
      </div>
      {drill ? (
        href ? (
          <a href={href} className="flex flex-col gap-3 after:absolute after:inset-0 after:rounded-lg">
            {/* Name = visible content (WCAG 2.5.3 label in name), prefixed with the metric. */}
            <span className="pt-sr-only">{label}: </span>
            {body}
            <span className="pt-sr-only">. {fmt(s.openRecords, { metric: label })}</span>
          </a>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="flex flex-col gap-3 text-start after:absolute after:inset-0 after:rounded-lg"
          >
            <span className="pt-sr-only">{label}: </span>
            {body}
            <span className="pt-sr-only">. {fmt(s.openRecords, { metric: label })}</span>
          </button>
        )
      ) : (
        <div className="flex flex-col gap-3">{body}</div>
      )}
    </div>
  );
}
