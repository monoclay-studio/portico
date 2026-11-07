import {
  ArrowRight,
  BedDouble,
  CircleAlert,
  Landmark,
  PiggyBank,
  Receipt,
  Scale,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Button } from './button';

export type ChangePreviewSectionKind = 'availability' | 'price' | 'taxes' | 'deposits' | 'balance';

export interface ChangePreviewRow {
  label: ReactNode;
  before: ReactNode;
  after: ReactNode;
  /** Signed difference, already formatted (e.g. "+USD 1,600.00", "−1 unit"). */
  delta?: ReactNode;
  /** Whether this row changes. Unchanged rows say "No change" instead of an arrow. */
  changed?: boolean;
  /** Draw attention (e.g. availability going to 0 or below). */
  attention?: 'warning' | 'danger';
}

export interface ChangePreviewSection {
  kind: ChangePreviewSectionKind;
  rows: readonly ChangePreviewRow[];
  note?: ReactNode;
}

export interface ChangePreviewProps {
  title: ReactNode;
  /** One sentence describing the requested change. */
  summary?: ReactNode;
  sections: readonly ChangePreviewSection[];
  /** Other effects: tasks created, messages, inventory released, agreed terms kept. */
  consequences?: readonly ReactNode[];
  /** Provenance slot (e.g. a SIMULATED badge while modules are mocked). */
  provenance?: ReactNode;
  /** Formatted time the preview stays valid until. */
  validUntil?: string | undefined;
  stale?: boolean;
  /**
   * Why this change cannot be made as previewed (infeasible preview). Confirm is disabled while any blocker is
   * shown (ux round 1, C6.2); the blockers say what to do instead.
   */
  blockers?: readonly ReactNode[];
  onRefresh?: () => void;
  onConfirm: () => void;
  onBack: () => void;
  confirming?: boolean;
  confirmLabel?: string;
  /** Problem from a failed confirm. */
  problem?: ReactNode;
}

const sectionIcon: Record<ChangePreviewSectionKind, ReactNode> = {
  availability: <BedDouble />,
  price: <Receipt />,
  taxes: <Landmark />,
  deposits: <PiggyBank />,
  balance: <Scale />,
};

/**
 * Before/after effect of a consequential change (glossary: change preview) — availability, price, taxes,
 * deposits and balance — with an explicit confirm. Nothing is committed until "Confirm change".
 */
export function ChangePreview({
  title,
  summary,
  sections,
  consequences,
  provenance,
  validUntil,
  stale,
  blockers = [],
  onRefresh,
  onConfirm,
  onBack,
  confirming,
  confirmLabel,
  problem,
}: ChangePreviewProps) {
  const { strings } = useUi();
  const s = strings.changePreview;
  return (
    <section aria-label={typeof title === 'string' ? title : undefined} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {provenance}
        </div>
        {summary && <p className="text-sm text-ink-muted">{summary}</p>}
      </header>

      {sections.map((sec) => (
        <div key={sec.kind} data-preview-section={sec.kind} className="rounded-md border border-line">
          <h3 className="flex items-center gap-2 border-b border-line bg-surface-muted px-3 py-2 text-sm font-semibold">
            <span aria-hidden className="inline-flex text-ink-muted [&_svg]:size-4">
              {sectionIcon[sec.kind]}
            </span>
            {s.sections[sec.kind]}
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead className="pt-sr-only">
              <tr>
                <th scope="col">{s.sections[sec.kind]}</th>
                <th scope="col">{s.before}</th>
                <th scope="col">{s.after}</th>
                <th scope="col">{s.change}</th>
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((r, i) => {
                const changed = r.changed ?? true;
                return (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within a section
                    key={i}
                    className={cn(
                      'border-b border-line last:border-b-0',
                      r.attention === 'danger' && 'bg-danger-bg',
                      r.attention === 'warning' && 'bg-warning-bg',
                    )}
                  >
                    <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        {r.attention && (
                          <TriangleAlert
                            aria-hidden
                            className={cn(
                              'size-4',
                              r.attention === 'danger' ? 'text-danger-fg' : 'text-warning-fg',
                            )}
                          />
                        )}
                        {r.label}
                      </span>
                    </th>
                    <td className="pt-tabular px-3 py-2 text-end text-ink-muted">
                      <span className="pt-sr-only">{s.before}: </span>
                      {r.before}
                    </td>
                    <td className="w-6 px-0 py-2 text-center text-ink-subtle" aria-hidden>
                      {changed ? <ArrowRight className="inline size-4 rtl:rotate-180" /> : null}
                    </td>
                    <td
                      className={cn(
                        'pt-tabular px-3 py-2 text-end',
                        changed ? 'font-semibold text-ink' : 'text-ink-muted',
                      )}
                    >
                      <span className="pt-sr-only">{s.after}: </span>
                      {changed ? r.after : s.noChange}
                    </td>
                    <td className="pt-tabular w-32 px-3 py-2 text-end text-xs text-ink-muted">
                      {changed && r.delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sec.note && <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">{sec.note}</p>}
        </div>
      ))}

      {consequences && consequences.length > 0 && (
        <div className="rounded-md border border-line p-3">
          <h3 className="mb-1 text-sm font-semibold">{s.consequences}</h3>
          <ul className="ms-5 list-disc text-sm text-ink">
            {consequences.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {stale ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-warning-line bg-warning-bg p-3 text-sm"
        >
          <CircleAlert aria-hidden className="size-4 text-warning-fg" />
          <span className="flex-1">{s.stale}</span>
          {onRefresh && (
            <Button size="sm" onClick={onRefresh}>
              {s.refresh}
            </Button>
          )}
        </div>
      ) : (
        validUntil && <p className="text-xs text-ink-muted">{fmt(s.expires, { time: validUntil })}</p>
      )}

      {blockers.length > 0 && (
        <div
          role="alert"
          data-preview-blocked
          className="flex items-start gap-2 rounded-md border border-danger-line border-s-4 border-s-danger-solid bg-danger-bg p-3 text-sm"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-fg" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{s.blocked}</p>
            {blockers.map((b, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blockers are positional messages
              <p key={i}>{b}</p>
            ))}
          </div>
        </div>
      )}

      {problem}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={confirming}>
          {s.back}
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          loading={confirming}
          disabled={stale || blockers.length > 0}
        >
          {confirmLabel ?? s.confirm}
        </Button>
      </div>
    </section>
  );
}
