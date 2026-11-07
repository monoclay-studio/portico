import {
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  type LucideIcon,
  SquareDashed,
  TestTubeDiagonal,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { formatRelative, formatTime } from '../lib/format';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Tooltip } from './tooltip';

/** CLAUDE.md §4.16 + §4.12 — data shown to users carries its provenance; sandbox results are labelled too. */
export const PROVENANCE_KINDS = [
  'live',
  'simulated',
  'sandbox',
  'copied',
  'delayed',
  'incomplete',
  'external',
] as const;
export type Provenance = (typeof PROVENANCE_KINDS)[number];

const spec: Record<Provenance, { icon: LucideIcon; className: string; hatch?: boolean }> = {
  live: { icon: CircleDot, className: 'border-line text-ink-muted bg-surface' },
  simulated: {
    icon: FlaskConical,
    className: 'border-simulated-fg text-simulated-fg bg-simulated-bg font-semibold',
    hatch: true,
  },
  sandbox: {
    icon: TestTubeDiagonal,
    className: 'border-dashed border-simulated-fg text-simulated-fg bg-simulated-bg font-semibold',
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
  /** ISO timestamp of the last successful sync (external/delayed). Shown as "last synced 3 min ago". */
  lastSyncedAt?: string | undefined;
  /** ISO timestamp when simulated/sandbox data was produced. Shown as "generated 10:42" (nothing was synced). */
  generatedAt?: string | undefined;
  /** Time zone for `generatedAt` (property time zone). */
  timeZone?: string;
  /** Clock for relative time (pass the app clock; defaults to now). */
  now?: Date;
  /** Compact: icon + kind only; details in tooltip. */
  compact?: boolean;
  /**
   * Interactive (a focusable button with a tooltip) by default. Pass false inside other interactive elements
   * (options, links, buttons) to avoid nested interactive controls; the description stays in the text.
   */
  interactive?: boolean;
  className?: string;
}

/**
 * Where the data on screen came from. Simulated data is hatched so it cannot be mistaken for live operations,
 * even in a screenshot. The accessible name starts with the visible text (WCAG 2.5.3).
 */
export function ProvenanceBadge({
  provenance,
  system,
  lastSyncedAt,
  generatedAt,
  timeZone = 'UTC',
  now,
  compact,
  interactive = true,
  className,
}: ProvenanceBadgeProps) {
  const { strings, locale } = useUi();
  const s = spec[provenance] ?? spec.incomplete;
  const Icon = s.icon;
  const kind = strings.provenance.kinds[provenance] ?? provenance;
  const synced = lastSyncedAt
    ? fmt(strings.provenance.lastSynced, { time: formatRelative(lastSyncedAt, now ?? new Date(), locale) })
    : generatedAt
      ? fmt(strings.provenance.generated, { time: formatTime(generatedAt, timeZone, locale) })
      : undefined;
  const from = system ? fmt(strings.provenance.from, { system }) : undefined;
  const visible = [kind, !compact ? system : undefined, !compact ? synced : undefined]
    .filter(Boolean)
    .join(' · ');
  const description = [strings.provenance.descriptions[provenance], from, synced].filter(Boolean).join(' · ');
  const classes = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs leading-5',
    s.className,
    s.hatch && 'pt-hatch [--pt-hatch-a:var(--pt-simulated-bg)] [--pt-hatch-b:var(--pt-simulated-stripe)]',
    className,
  );
  const content = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span>{kind}</span>
      {!compact && system && <span className="font-normal">· {system}</span>}
      {!compact && synced && <span className="font-normal opacity-90">· {synced}</span>}
    </>
  );
  if (!interactive) {
    return (
      <span data-provenance={provenance} className={classes}>
        {content}
        <span className="pt-sr-only">. {description}</span>
      </span>
    );
  }
  return (
    <Tooltip content={description}>
      <button
        type="button"
        data-provenance={provenance}
        aria-label={`${visible}. ${description}`}
        className={cn(classes, 'cursor-help')}
      >
        {content}
      </button>
    </Tooltip>
  );
}
