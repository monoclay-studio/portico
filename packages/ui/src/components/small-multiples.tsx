import { type KeyboardEvent, useId, useState } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';

export interface MultiplePoint {
  /** Axis label (short), e.g. "14". */
  x: string;
  /** Full label for tooltips/table, e.g. "Sat 14 Nov". */
  xLabel: string;
  value: number;
  /** Extra detail, e.g. "33 of 40 villas". */
  detail?: string;
}

export interface MultipleSeries {
  id: string;
  label: string;
  points: readonly MultiplePoint[];
}

/**
 * Small multiples of column charts — one per series on a shared scale (no dual axes, no legend needed: each
 * title names its single series). Hover or keyboard (focus a chart, ←/→) shows each night's value; a table view
 * carries every value without hovering.
 */
export function SmallMultiples({
  label,
  series,
  max,
  format,
  height = 56,
  showTable,
}: {
  label: string;
  series: readonly MultipleSeries[];
  /** Shared scale maximum (e.g. 1 for shares). */
  max: number;
  format: (v: number) => string;
  height?: number;
  showTable?: boolean;
}) {
  const { strings, dir } = useUi();
  if (showTable) {
    const xs = series[0]?.points ?? [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="pt-sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-2 py-1.5 text-start text-xs font-medium text-ink-muted" />
              {xs.map((p) => (
                <th key={p.xLabel} scope="col" className="pt-data px-1.5 py-1.5 text-end font-medium">
                  {p.x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-start font-medium">
                  {s.label}
                </th>
                {s.points.map((p) => (
                  <td key={p.xLabel} className="pt-tabular px-1.5 py-1.5 text-end" title={p.detail}>
                    {format(p.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>
      {series.map((s) => (
        <li key={s.id}>
          <Multiple
            series={s}
            max={max}
            format={format}
            height={height}
            rtl={dir === 'rtl'}
            valueLabel={strings.chart.value}
          />
        </li>
      ))}
    </ul>
  );
}

function Multiple({
  series,
  max,
  format,
  height,
  rtl,
}: {
  series: MultipleSeries;
  max: number;
  format: (v: number) => string;
  height: number;
  rtl: boolean;
  valueLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const n = series.points.length;
  const first = series.points[0];
  const shown = active !== null ? series.points[active] : undefined;
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (step) {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? -1) + step)));
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="truncate text-sm font-medium" id={`${id}-t`}>
          {series.label}
        </h4>
        <span className="pt-data text-ink-muted" aria-live="polite">
          {shown
            ? `${shown.xLabel} · ${format(shown.value)}${shown.detail ? ` · ${shown.detail}` : ''}`
            : first
              ? `${first.xLabel} · ${format(first.value)}`
              : ''}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus lets keyboard users read each column (arrow keys) */}
      <div
        role="group"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="relative flex items-end gap-0.5 border-b border-viz-grid"
        style={{ height }}
      >
        <span id={`${id}-d`} className="pt-sr-only">
          {series.points.map((p) => `${p.xLabel} ${format(p.value)}`).join(', ')}
        </span>
        {series.points.map((p, i) => (
          <span
            key={p.xLabel}
            aria-hidden
            onMouseEnter={() => setActive(i)}
            className="flex h-full flex-1 items-end justify-center"
          >
            <span
              className={cn(
                'w-full max-w-6 rounded-t-[4px] bg-viz-seq',
                active !== null && active !== i && 'opacity-45',
              )}
              style={{ height: `${Math.max(2, (Math.min(p.value, max) / max) * 100)}%` }}
            />
          </span>
        ))}
      </div>
      <div aria-hidden className="pt-data flex justify-between text-ink-muted">
        <span>{series.points[0]?.x}</span>
        <span>{series.points[n - 1]?.x}</span>
      </div>
    </div>
  );
}
