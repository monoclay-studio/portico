import {
  BadgeCheck,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  Clock3,
  CreditCard,
  DoorClosed,
  DoorOpen,
  FileQuestion,
  FileText,
  Gavel,
  Home,
  Hourglass,
  ListOrdered,
  Lock,
  LogIn,
  LogOut,
  type LucideIcon,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SprayCan,
  TriangleAlert,
  User,
  UserCheck,
  UserX,
  Wrench,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';

/**
 * Status vocabularies (glossary; ux-principles §4). Booking status, stay status, occupancy (+ discrepancy), unit
 * condition, unit availability, inventory cells and payment status stay SEPARATE everywhere — never merged into one
 * field or one badge. Each has its own visual grammar (shape + icon set) in addition to colour and text:
 *
 * | vocabulary        | shape                                   |
 * |-------------------|-----------------------------------------|
 * | booking           | square tag, soft fill                   |
 * | stay              | outlined pill                           |
 * | occupancy         | bare icon + text (no container)         |
 * | discrepancy       | bare icon + text, warning               |
 * | condition         | tag with a thick inline-start stripe    |
 * | unitAvailability  | square tag; hatched when out of order   |
 * | inventory         | solid pill (optionally with a count)    |
 * | payment           | bordered tag; dashed while unconfirmed  |
 *
 * Values follow the real module contracts (reservations `stayStatus`/`bookingStatus` and payment summary,
 * operations `unitCondition`/`occupancy`/`discrepancy`/block kinds, payments' payment/authorization states).
 * A value outside the vocabulary NEVER crashes a screen: it renders as a neutral chip with the raw code and is
 * reported once (console + `onUnknownStatus`).
 */
export const STATUS_VALUES = {
  booking: [
    'inquiry',
    'quoted',
    'held',
    'tentative',
    'confirmed',
    'cancelled',
    'declined',
    'expired',
    'completed',
  ],
  stay: ['expected', 'in_house', 'departed', 'cancelled', 'no_show', 'waitlisted'],
  occupancy: ['vacant', 'occupied'],
  discrepancy: ['skip', 'sleep', 'occupied_no_luggage'],
  condition: ['dirty', 'cleaning', 'clean', 'inspected', 'failed_inspection'],
  unitAvailability: ['available', 'assigned', 'out_of_order', 'out_of_service', 'house_use'],
  inventory: ['available', 'limited', 'sold_out', 'held', 'overbooked_authorized', 'oversold'],
  payment: [
    'none',
    'requested',
    'requires_action',
    'processing',
    'pending_verification',
    'authorized',
    'partially_captured',
    'captured',
    'partially_paid',
    'paid',
    'succeeded',
    'awaiting_receipt',
    'recorded_unverified',
    'recorded_verified',
    'failed',
    'voided',
    'expired',
    'cancelled',
    'refunded',
    'disputed',
    'unknown',
  ],
} as const;

export type StatusVocabulary = keyof typeof STATUS_VALUES;
export type BookingStatus = (typeof STATUS_VALUES.booking)[number];
export type StayStatus = (typeof STATUS_VALUES.stay)[number];
export type OccupancyStatus = (typeof STATUS_VALUES.occupancy)[number];
export type DiscrepancyStatus = (typeof STATUS_VALUES.discrepancy)[number];
export type UnitCondition = (typeof STATUS_VALUES.condition)[number];
export type UnitAvailabilityStatus = (typeof STATUS_VALUES.unitAvailability)[number];
export type InventoryStatus = (typeof STATUS_VALUES.inventory)[number];
export type PaymentStatus = (typeof STATUS_VALUES.payment)[number];
export type StatusValue<V extends StatusVocabulary> = (typeof STATUS_VALUES)[V][number];

export function isKnownStatus<V extends StatusVocabulary>(
  vocabulary: V,
  value: string,
): value is StatusValue<V> {
  return (STATUS_VALUES[vocabulary] as readonly string[]).includes(value);
}

/** Status family names used by server contracts (`status` maps on record summaries) → UI vocabulary. */
const FAMILY_ALIASES: Record<string, StatusVocabulary> = {
  booking: 'booking',
  bookingStatus: 'booking',
  stay: 'stay',
  stayStatus: 'stay',
  payment: 'payment',
  occupancy: 'occupancy',
  discrepancy: 'discrepancy',
  condition: 'condition',
  unitCondition: 'condition',
  unitAvailability: 'unitAvailability',
  availability: 'unitAvailability',
  inventory: 'inventory',
};

/** The vocabulary for a server status family, or null for a family the UI has no vocabulary for. */
export function vocabularyForFamily(family: string): StatusVocabulary | null {
  return Object.hasOwn(FAMILY_ALIASES, family) ? (FAMILY_ALIASES[family] ?? null) : null;
}

/** "unitCondition" / "unit_condition" → "Unit condition" (for families without a vocabulary). */
export function humanizeCode(v: string): string {
  const spaced = v
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'pending' | 'neutral' | 'accent';

interface Spec {
  tone: Tone;
  icon: LucideIcon;
  /** Not a final, confirmed outcome (rendered dashed). */
  provisional?: boolean;
  /** Pattern for out-of-order units (not colour alone). */
  hatch?: boolean;
}

export const STATUS_SPECS: { [V in StatusVocabulary]: Record<StatusValue<V>, Spec> } = {
  booking: {
    inquiry: { tone: 'neutral', icon: FileQuestion },
    quoted: { tone: 'info', icon: FileText },
    held: { tone: 'pending', icon: Hourglass },
    tentative: { tone: 'warning', icon: CalendarClock },
    confirmed: { tone: 'success', icon: CalendarCheck },
    cancelled: { tone: 'neutral', icon: CalendarX },
    declined: { tone: 'neutral', icon: Ban },
    expired: { tone: 'neutral', icon: Clock3 },
    completed: { tone: 'accent', icon: CircleCheck },
  },
  stay: {
    expected: { tone: 'info', icon: LogIn },
    in_house: { tone: 'success', icon: DoorClosed },
    departed: { tone: 'neutral', icon: LogOut },
    cancelled: { tone: 'neutral', icon: CircleSlash },
    no_show: { tone: 'danger', icon: UserX },
    waitlisted: { tone: 'pending', icon: ListOrdered },
  },
  occupancy: {
    vacant: { tone: 'neutral', icon: DoorOpen },
    occupied: { tone: 'info', icon: User },
  },
  discrepancy: {
    skip: { tone: 'warning', icon: TriangleAlert },
    sleep: { tone: 'warning', icon: TriangleAlert },
    occupied_no_luggage: { tone: 'warning', icon: TriangleAlert },
  },
  condition: {
    dirty: { tone: 'danger', icon: SprayCan },
    cleaning: { tone: 'pending', icon: CircleDashed },
    clean: { tone: 'info', icon: Sparkles },
    inspected: { tone: 'success', icon: BadgeCheck },
    failed_inspection: { tone: 'danger', icon: XCircle },
  },
  unitAvailability: {
    available: { tone: 'success', icon: CircleDot },
    assigned: { tone: 'info', icon: UserCheck },
    out_of_order: { tone: 'danger', icon: Wrench, hatch: true },
    out_of_service: { tone: 'warning', icon: Wrench },
    house_use: { tone: 'neutral', icon: Home },
  },
  inventory: {
    available: { tone: 'success', icon: CircleDot },
    limited: { tone: 'warning', icon: CircleDot },
    sold_out: { tone: 'neutral', icon: CircleSlash },
    held: { tone: 'pending', icon: Hourglass },
    overbooked_authorized: { tone: 'warning', icon: ShieldCheck },
    oversold: { tone: 'danger', icon: TriangleAlert },
  },
  payment: {
    none: { tone: 'neutral', icon: CreditCard },
    requested: { tone: 'info', icon: Clock3, provisional: true },
    requires_action: { tone: 'warning', icon: TriangleAlert, provisional: true },
    processing: { tone: 'pending', icon: Hourglass, provisional: true },
    pending_verification: { tone: 'pending', icon: Hourglass, provisional: true },
    authorized: { tone: 'pending', icon: Lock, provisional: true },
    partially_captured: { tone: 'warning', icon: CreditCard },
    captured: { tone: 'success', icon: CircleCheck },
    partially_paid: { tone: 'warning', icon: CreditCard },
    paid: { tone: 'success', icon: CircleCheck },
    succeeded: { tone: 'success', icon: CircleCheck },
    awaiting_receipt: { tone: 'info', icon: Receipt, provisional: true },
    recorded_unverified: { tone: 'pending', icon: Receipt, provisional: true },
    recorded_verified: { tone: 'success', icon: Receipt },
    failed: { tone: 'danger', icon: XCircle },
    voided: { tone: 'neutral', icon: CircleSlash },
    expired: { tone: 'neutral', icon: Clock3 },
    cancelled: { tone: 'neutral', icon: CircleSlash },
    refunded: { tone: 'neutral', icon: RotateCcw },
    disputed: { tone: 'danger', icon: Gavel },
    unknown: { tone: 'pending', icon: CircleHelp, provisional: true },
  },
};

const toneSoft: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg border-success-line',
  warning: 'bg-warning-bg text-warning-fg border-warning-line',
  danger: 'bg-danger-bg text-danger-fg border-danger-line',
  info: 'bg-info-bg text-info-fg border-info-line',
  pending: 'bg-pending-bg text-pending-fg border-pending-line',
  neutral: 'bg-neutral-bg text-neutral-fg border-neutral-line',
  accent: 'bg-accent-soft text-accent border-accent-line',
};
const toneText: Record<Tone, string> = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
  pending: 'text-pending-fg',
  neutral: 'text-neutral-fg',
  accent: 'text-accent',
};
const toneLine: Record<Tone, string> = {
  success: 'border-success-line',
  warning: 'border-warning-line',
  danger: 'border-danger-line',
  info: 'border-info-line',
  pending: 'border-pending-line',
  neutral: 'border-neutral-line',
  accent: 'border-accent-line',
};
const toneStripe: Record<Tone, string> = {
  success: 'border-s-success-solid',
  warning: 'border-s-warning-solid',
  danger: 'border-s-danger-solid',
  info: 'border-s-info-solid',
  pending: 'border-s-pending-solid',
  neutral: 'border-s-neutral-line',
  accent: 'border-s-accent',
};

const shapes: Record<StatusVocabulary, (tone: Tone, spec: Spec) => string> = {
  booking: (t) =>
    cn(
      'rounded-sm border border-transparent px-1.5 font-semibold uppercase tracking-wide text-[0.6875rem]',
      toneSoft[t],
    ),
  stay: (t) => cn('rounded-full border bg-surface px-2', toneText[t], toneLine[t]),
  occupancy: (t) => cn('px-0', toneText[t]),
  discrepancy: (t) => cn('px-0 font-medium', toneText[t]),
  condition: (t) => cn('rounded-sm border border-s-4 px-1.5', toneSoft[t], toneStripe[t]),
  unitAvailability: (t, s) =>
    cn(
      'rounded-sm border px-1.5',
      toneSoft[t],
      s.hatch && 'pt-hatch [--pt-hatch-a:var(--pt-danger-bg)] [--pt-hatch-b:var(--pt-bar-block-stripe)]',
    ),
  inventory: (t) => cn('rounded-full border px-2 font-medium', toneSoft[t]),
  payment: (t, s) =>
    cn('rounded-md border px-1.5', toneSoft[t], s.provisional ? 'border-dashed border-current' : ''),
};

const reported = new Set<string>();
let unknownStatusReporter: ((vocabulary: string, value: string) => void) | null = null;

/** Apps can forward unknown status values to their error reporting. */
export function onUnknownStatus(reporter: ((vocabulary: string, value: string) => void) | null) {
  unknownStatusReporter = reporter;
}

function reportUnknown(vocabulary: string, value: string) {
  const key = `${vocabulary}:${value}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[@portico/ui] Unrecognised ${vocabulary} status "${value}" rendered as a neutral chip.`);
  unknownStatusReporter?.(vocabulary, value);
}

export interface StatusBadgeProps<V extends StatusVocabulary> {
  vocabulary: V;
  /** A value of the vocabulary. Unknown values (from a newer server) render as a neutral chip — never a crash. */
  value: StatusValue<V> | (string & {});
  /** Show the vocabulary name visibly ("Stay: In house"). It is always announced to screen readers. */
  showVocabulary?: boolean;
  /** Override the label (e.g. "Arriving today"); vocabulary meaning and icon stay the same. */
  label?: string;
  /** For inventory: units available. */
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge<V extends StatusVocabulary>({
  vocabulary,
  value,
  showVocabulary,
  label,
  count,
  size = 'sm',
  className,
}: StatusBadgeProps<V>) {
  const { strings } = useUi();
  const vocabName = strings.status.vocabularies[vocabulary];
  const known = isKnownStatus(vocabulary, value);
  const spec: Spec = known
    ? ((STATUS_SPECS[vocabulary] as Record<string, Spec>)[value] as Spec)
    : { tone: 'neutral', icon: CircleHelp };
  if (!known) reportUnknown(vocabulary, value);
  const text =
    label ?? (known ? (strings.status[vocabulary] as Record<string, string>)[value] : humanizeCode(value));
  const Icon = spec.icon;
  return (
    <span
      data-vocabulary={vocabulary}
      data-status={value}
      {...(known ? {} : { 'data-unknown-status': '', title: fmt(strings.status.unknownValue, { value }) })}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap leading-5',
        size === 'sm' ? 'text-xs' : 'text-sm',
        known
          ? shapes[vocabulary](spec.tone, spec)
          : 'rounded-sm border border-dashed border-neutral-line px-1.5 text-neutral-fg',
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
        strokeWidth={2.25}
      />
      <span className="pt-sr-only">{vocabName}: </span>
      {showVocabulary && <span className="font-normal">{vocabName}:</span>}
      <span className="truncate">{text}</span>
      {count !== undefined && <span className="pt-tabular font-semibold">{count}</span>}
    </span>
  );
}

/** Server-computed presentation of a payment state (payments `statusPresentation`). Preferred when present. */
export interface StatusPresentation {
  label: string;
  tone: 'success' | 'pending' | 'failure' | 'neutral' | 'recorded';
  explanation: string;
  /** Never true unless the provider (or statement matching) confirmed it. */
  confirmed: boolean;
}

const presentedTone: Record<StatusPresentation['tone'], { tone: Tone; icon: LucideIcon }> = {
  success: { tone: 'success', icon: CircleCheck },
  pending: { tone: 'pending', icon: Hourglass },
  failure: { tone: 'danger', icon: XCircle },
  neutral: { tone: 'neutral', icon: CreditCard },
  recorded: { tone: 'info', icon: Receipt },
};

/**
 * Renders the payments module's own presentation (label, tone, explanation, confirmed). Unconfirmed outcomes are
 * dashed whatever the tone, so "recorded" or "pending" can never be read as paid.
 */
export function PresentedStatusBadge({
  presentation,
  className,
}: {
  presentation: StatusPresentation;
  className?: string;
}) {
  const { strings } = useUi();
  const p = presentedTone[presentation.tone] ?? presentedTone.neutral;
  const Icon = p.icon;
  return (
    <span
      data-vocabulary="payment"
      data-presented
      title={presentation.explanation}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs leading-5',
        toneSoft[p.tone],
        !presentation.confirmed && 'border-dashed border-current',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span className="pt-sr-only">{strings.status.vocabularies.payment}: </span>
      <span className="truncate">{presentation.label}</span>
      <span className="pt-sr-only">. {presentation.explanation}</span>
    </span>
  );
}
