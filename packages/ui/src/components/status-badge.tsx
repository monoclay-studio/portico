import {
  BadgeCheck,
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Clock3,
  CreditCard,
  DoorClosed,
  DoorOpen,
  FileQuestion,
  FileText,
  Hourglass,
  ListOrdered,
  Lock,
  LogIn,
  LogOut,
  type LucideIcon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SprayCan,
  TriangleAlert,
  User,
  UserX,
  Wrench,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';

/**
 * Status vocabularies. The glossary requires booking status, stay status, occupancy, unit condition,
 * availability and payment status to stay SEPARATE everywhere — never merged into one field or one badge.
 * Each vocabulary therefore has its own visual grammar (shape + icon set), in addition to colour and text:
 *
 * | vocabulary   | shape                                   |
 * |--------------|-----------------------------------------|
 * | booking      | square tag, soft fill                   |
 * | stay         | outlined pill                           |
 * | occupancy    | bare icon + text (no container)         |
 * | condition    | tag with a thick inline-start stripe    |
 * | availability | solid pill (optionally with a count)    |
 * | payment      | bordered tag; dashed while unconfirmed  |
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
  occupancy: ['vacant', 'occupied', 'skip', 'sleep'],
  condition: ['dirty', 'cleaning', 'clean', 'inspected', 'failed_inspection'],
  availability: ['available', 'limited', 'sold_out', 'held', 'blocked', 'overbooked_authorized', 'oversold'],
  payment: [
    'not_required',
    'unpaid',
    'requested',
    'authorized',
    'pending_verification',
    'partially_paid',
    'paid',
    'failed',
    'refunded',
    'guaranteed',
  ],
} as const;

export type StatusVocabulary = keyof typeof STATUS_VALUES;
export type BookingStatus = (typeof STATUS_VALUES.booking)[number];
export type StayStatus = (typeof STATUS_VALUES.stay)[number];
export type OccupancyStatus = (typeof STATUS_VALUES.occupancy)[number];
export type UnitCondition = (typeof STATUS_VALUES.condition)[number];
export type AvailabilityStatus = (typeof STATUS_VALUES.availability)[number];
export type PaymentStatus = (typeof STATUS_VALUES.payment)[number];
export type StatusValue<V extends StatusVocabulary> = (typeof STATUS_VALUES)[V][number];

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'pending' | 'neutral' | 'accent';

interface Spec {
  tone: Tone;
  icon: LucideIcon;
  /** Payment: the status is not a final, provider-confirmed outcome (rendered dashed). */
  provisional?: boolean;
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
    skip: { tone: 'warning', icon: TriangleAlert },
    sleep: { tone: 'warning', icon: TriangleAlert },
  },
  condition: {
    dirty: { tone: 'danger', icon: SprayCan },
    cleaning: { tone: 'pending', icon: CircleDashed },
    clean: { tone: 'info', icon: Sparkles },
    inspected: { tone: 'success', icon: BadgeCheck },
    failed_inspection: { tone: 'danger', icon: XCircle },
  },
  availability: {
    available: { tone: 'success', icon: CircleDot },
    limited: { tone: 'warning', icon: CircleDot },
    sold_out: { tone: 'neutral', icon: CircleSlash },
    held: { tone: 'pending', icon: Hourglass },
    blocked: { tone: 'neutral', icon: Wrench },
    overbooked_authorized: { tone: 'warning', icon: ShieldCheck },
    oversold: { tone: 'danger', icon: TriangleAlert },
  },
  payment: {
    not_required: { tone: 'neutral', icon: CircleSlash },
    unpaid: { tone: 'warning', icon: CreditCard },
    requested: { tone: 'info', icon: Clock3, provisional: true },
    authorized: { tone: 'pending', icon: Lock, provisional: true },
    pending_verification: { tone: 'pending', icon: Hourglass, provisional: true },
    partially_paid: { tone: 'warning', icon: CreditCard },
    paid: { tone: 'success', icon: CircleCheck },
    failed: { tone: 'danger', icon: XCircle },
    refunded: { tone: 'neutral', icon: RotateCcw },
    guaranteed: { tone: 'info', icon: ShieldCheck },
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
  condition: (t) => cn('rounded-sm border border-s-4 px-1.5', toneSoft[t], toneStripe[t]),
  availability: (t) => cn('rounded-full border px-2 font-medium', toneSoft[t]),
  payment: (t, s) =>
    cn('rounded-md border px-1.5', toneSoft[t], s.provisional ? 'border-dashed border-current' : ''),
};

export interface StatusBadgeProps<V extends StatusVocabulary> {
  vocabulary: V;
  value: StatusValue<V>;
  /** Show the vocabulary name visibly ("Stay: In house"). It is always announced to screen readers. */
  showVocabulary?: boolean;
  /** Override the label (e.g. "Arriving today"); vocabulary meaning and icon stay the same. */
  label?: string;
  /** For availability: units available. */
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
  const spec = (STATUS_SPECS[vocabulary] as Record<string, Spec>)[value];
  if (!spec) throw new Error(`Unknown ${vocabulary} status: ${String(value)}`);
  const vocabName = strings.status.vocabularies[vocabulary];
  const text = label ?? (strings.status[vocabulary] as Record<string, string>)[value] ?? String(value);
  const Icon = spec.icon;
  return (
    <span
      data-vocabulary={vocabulary}
      data-status={value}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap leading-5',
        size === 'sm' ? 'text-xs' : 'text-sm',
        shapes[vocabulary](spec.tone, spec),
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4')}
        strokeWidth={2.25}
      />
      <span className="pt-sr-only">{vocabName}: </span>
      {showVocabulary && <span className="font-normal opacity-80">{vocabName}:</span>}
      <span className="truncate">{text}</span>
      {count !== undefined && <span className="pt-tabular font-semibold">{count}</span>}
    </span>
  );
}
