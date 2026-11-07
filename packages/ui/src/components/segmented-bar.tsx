import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { Tooltip } from './tooltip';

export type SegmentKind = 'good' | 'warning' | 'critical' | 'neutral' | 'seq';

export interface Segment {
  id: string;
  label: string;
  value: number;
  /** Status kinds carry meaning (always with icon + label in the legend); `seq`/`neutral` carry none. */
  kind: SegmentKind;
  icon?: ReactNode;
}

const fill: Record<SegmentKind, string> = {
  good: 'bg-viz-good text-[oklch(0.18_0_0)]',
  warning: 'bg-viz-warning text-[oklch(0.18_0_0)]',
  critical: 'bg-viz-critical text-white',
  neutral: 'bg-viz-neutral text-[oklch(0.18_0_0)]',
  seq: 'bg-viz-seq text-white',
};
const swatch: Record<SegmentKind, string> = {
  good: 'bg-viz-good',
  warning: 'bg-viz-warning',
  critical: 'bg-viz-critical',
  neutral: 'bg-viz-neutral',
  seq: 'bg-viz-seq',
};

/**
 * Tall segmented bar (dataviz "one whole split into ≤ 6 parts"): 28px, 2px surface gaps, share printed inside
 * when it fits, legend with names only (in block order). Every part has an accessible name with its amount and
 * share; clicking a part drills into its records.
 */
export function SegmentedBar({
  label,
  segments,
  onSelect,
  unit,
}: {
  label: string;
  segments: readonly Segment[];
  onSelect?: (segment: Segment) => void;
  /** Unit for announcements, e.g. "arrivals". */
  unit?: string;
}) {
  const { strings, locale } = useUi();
  const total = segments.reduce((n, s) => n + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const nf = new Intl.NumberFormat(locale);
  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      <ul className="flex h-7 w-full gap-0.5">
        {visible.map((s) => {
          const share = pct(s.value);
          const name = `${s.label}: ${nf.format(s.value)} of ${nf.format(total)}${unit ? ` ${unit}` : ''} (${share}%)`;
          const inner = (
            <>
              <span aria-hidden className="pt-data truncate px-1.5 font-semibold normal-case">
                {share >= 12 ? `${share}%` : ''}
              </span>
              <span className="pt-sr-only">{name}</span>
            </>
          );
          const cls = cn('flex h-full w-full items-center rounded-sm', fill[s.kind]);
          return (
            <li key={s.id} className="flex min-w-1" style={{ flexGrow: s.value, flexBasis: 0 }}>
              <Tooltip content={name}>
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className={cn(cls, 'hover:brightness-110')}
                  >
                    {inner}
                  </button>
                ) : (
                  <span className={cls}>{inner}</span>
                )}
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <figcaption>
        <span className="pt-sr-only">{strings.chart.legend}: </span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5 text-xs text-ink">
              <span aria-hidden className={cn('inline-block size-2.5 rounded-sm', swatch[s.kind])} />
              {s.icon && (
                <span aria-hidden className="inline-flex text-ink-muted [&_svg]:size-3.5">
                  {s.icon}
                </span>
              )}
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
