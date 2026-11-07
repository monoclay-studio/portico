import { GitCompare } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Button } from './button';
import type { ConflictKind, ConflictRowModel } from './conflict';
import { Dialog } from './dialog';

export interface ConflictDialogRow extends ConflictRowModel {
  label: string;
  /** Formatter for values (dates, money, enums). Defaults to String(). */
  format?: (value: unknown) => ReactNode;
}

export interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human entity name, e.g. "property", "reservation". */
  entity: string;
  rows: readonly ConflictDialogRow[];
  expectedVersion?: number | string | undefined;
  currentVersion?: number | string | undefined;
  /** Who saved the newer version and when (from audit), if known. */
  changedBy?: string | undefined;
  changedAt?: string | undefined;
  /** Re-apply the selected fields (keys) on top of the latest version, with its ETag. */
  onReapply: (keys: string[]) => void;
  /** Throw away my edits and keep the saved version. */
  onDiscard: () => void;
  reapplying?: boolean;
  /** Problem from a failed re-apply (e.g. yet another conflict). */
  children?: ReactNode;
}

const kindStyle: Record<ConflictKind, string> = {
  both: 'border-s-4 border-s-warning-solid bg-warning-bg',
  mine: 'border-s-4 border-s-info-solid',
  theirs: 'border-s-4 border-s-neutral-line',
  same: '',
};

/**
 * 409 version_conflict resolution (scenario S14): shows my change vs the saved version per field, marks fields
 * both people changed, and re-applies the fields the user keeps — never a silent overwrite, never lost work.
 */
export function ConflictDialog({
  open,
  onOpenChange,
  entity,
  rows,
  expectedVersion,
  currentVersion,
  changedBy,
  changedAt,
  onReapply,
  onDiscard,
  reapplying,
  children,
}: ConflictDialogProps) {
  const { strings } = useUi();
  const s = strings.conflict;
  const mineKeys = useMemo(
    () => rows.filter((r) => r.kind === 'mine' || r.kind === 'both').map((r) => r.key),
    [rows],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(mineKeys));
  useEffect(() => setSelected(new Set(mineKeys)), [mineKeys]);
  const visible = rows.filter((r) => r.kind !== 'same');
  const fmtValue = (r: ConflictDialogRow, v: unknown) =>
    r.format ? r.format(v) : v === null || v === undefined || v === '' ? '—' : String(v);
  const kindLabel: Record<ConflictKind, string> = {
    both: s.bothChanged,
    mine: s.onlyYou,
    theirs: s.onlyThem,
    same: '',
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      modalStrict
      icon={<GitCompare className="text-warning-fg" />}
      title={fmt(s.title, { entity })}
      description={fmt(s.intro, { entity })}
      footer={
        <>
          <Button variant="ghost" onClick={onDiscard} disabled={reapplying}>
            {s.discard}
          </Button>
          <Button
            variant="primary"
            loading={reapplying}
            disabled={selected.size === 0}
            onClick={() => onReapply([...selected])}
          >
            {selected.size === mineKeys.length ? s.reapply : fmt(s.reapplySelected, { count: selected.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {(changedBy || expectedVersion !== undefined) && (
          <p className="text-sm text-ink-muted">
            {changedBy && <span>{fmt(s.changedBy, { who: changedBy, when: changedAt ?? '' })} · </span>}
            {expectedVersion !== undefined &&
              fmt(s.versionNote, {
                expected: String(expectedVersion),
                current: String(currentVersion ?? '?'),
              })}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="pt-sr-only">{fmt(s.title, { entity })}</caption>
            <thead>
              <tr className="border-b border-line text-start text-xs text-ink-muted">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {s.field}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {s.original}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {s.yours}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {s.theirs}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const selectable = r.kind === 'mine' || r.kind === 'both';
                const id = `conflict-${r.key}`;
                return (
                  <tr
                    key={r.key}
                    data-conflict={r.kind}
                    className={cn('border-b border-line align-top', kindStyle[r.kind])}
                  >
                    <th scope="row" className="px-2 py-2 text-start font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{r.label}</span>
                        <span className="text-xs font-normal text-ink-muted">{kindLabel[r.kind]}</span>
                      </div>
                    </th>
                    <td className="px-2 py-2 text-ink-muted">{fmtValue(r, r.original)}</td>
                    <td className="px-2 py-2">
                      {selectable ? (
                        <label htmlFor={id} className="flex items-start gap-2">
                          <input
                            id={id}
                            type="checkbox"
                            className="mt-0.5 size-4 accent-[var(--pt-accent)]"
                            checked={selected.has(r.key)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(r.key);
                              else next.delete(r.key);
                              setSelected(next);
                            }}
                          />
                          <span>
                            <span className="font-medium">{fmtValue(r, r.mine)}</span>
                            <span className="pt-sr-only"> — {s.keepThisChange}</span>
                          </span>
                        </label>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-medium">{fmtValue(r, r.theirs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {children}
      </div>
    </Dialog>
  );
}
