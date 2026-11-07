import {
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  type LucideIcon,
  SquareDashed,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Tooltip } from './tooltip';

/** CLAUDE.md §4.16 — data shown to users carries its provenance. */
export const PROVENANCE_KINDS = ['live', 'simulated', 'copied', 'delayed', 'incomplete', 'external'] as const;
export type Provenance = (typeof PROVENANCE_KINDS)[number];

const spec: Record<Provenance, { icon: LucideIcon; className: string; hatch?: boolean }> = {
  live: { icon: CircleDot, className: 'border-line text-ink-muted bg-surface' },
  simulated: {
    icon: FlaskConical,
    className: 'border-simulated-fg text-simulated-fg bg-simulated-bg font-semibold uppercase tracking-wide',
    hatch: true,
  },
  copied: { icon: Copy, className: 'border-dashed border-info-line text-info-fg bg-info-bg' },
  delayed: { icon: Clock3, className: 'border-warning-line text-warning-fg bg-warning-bg' },
  incomplete: {
    icon: SquareDashed,
    className: 'border-dashed border-warning-line text-warning-fg bg-surface',
  },
  external: { icon: ExternalLink, className: 'border-accent-line text-accent bg-accent-soft' },
};

export interface ProvenanceBadgeProps {
  provenance: Provenance;
  /** External system name for `external` (e.g. "OPERA Cloud PMS"). */
  system?: string | undefined;
  /** ISO timestamp of the last successful sync. Shown as "last synced 3 min ago". */
  lastSyncedAt?: string | undefined;
  /** Clock for relative time (pass the app clock; defaults to now). */
  now?: Date;
  /** Compact: icon + kind only; details in tooltip. */
  compact?: boolean;
  className?: string;
}

/**
 * Where the data on screen came from. Simulated data is hatched and uppercase so it cannot be mistaken for
 * live operations, even in a screenshot.
 */
export function ProvenanceBadge({
  provenance,
  system,
  lastSyncedAt,
  now,
  compact,
  className,
}: ProvenanceBadgeProps) {
  const { strings, locale } = useUi();
  const s = spec[provenance];
  const Icon = s.icon;
  const kind = strings.provenance.kinds[provenance];
  const synced = lastSyncedAt
    ? fmt(strings.provenance.lastSynced, { time: formatRelative(lastSyncedAt, now ?? new Date(), locale) })
    : undefined;
  const from = system ? fmt(strings.provenance.from, { system }) : undefined;
  const description = [strings.provenance.descriptions[provenance], from, synced].filter(Boolean).join(' · ');
  const badge = (
    <button
      type="button"
      data-provenance={provenance}
      // A button so keyboard users can reach the explanation tooltip; the description is also in the name.
      aria-label={`${strings.provenance.label}: ${kind}. ${description}`}
      className={cn(
        'inline-flex shrink-0 cursor-help items-center gap-1 rounded-sm border px-1.5 text-xs leading-5',
        s.className,
        s.hatch && 'pt-hatch [--pt-hatch-a:var(--pt-simulated-bg)] [--pt-hatch-b:var(--pt-simulated-stripe)]',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span>{kind}</span>
      {!compact && from && <span className="font-normal normal-case tracking-normal">· {system}</span>}
      {!compact && synced && (
        <span className="font-normal normal-case tracking-normal opacity-90">· {synced}</span>
      )}
    </button>
  );
  return <Tooltip content={description}>{badge}</Tooltip>;
}
