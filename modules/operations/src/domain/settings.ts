import type {
  DepartmentKind,
  EscalationTarget,
  TaskKind,
  TaskPriority,
  UnitCondition,
  Urgency,
} from './model';

/**
 * Per-property operations settings. Stored as ONE platform policy (`operations.settings`, inheritable from
 * organization/brand/region with local overrides) holding a partial object; missing keys fall back to these
 * defaults. Values are hotel configuration, never hard-coded behavior.
 */
export interface EscalationStep {
  /** Minutes after the anchor at which this step fires. */
  afterMinutes: number;
  target: EscalationTarget;
  /**
   * Anchor: `due` (default) — the task is overdue; `created` — the task was not acknowledged (started) within
   * `afterMinutes` of being created (OPS-R12).
   */
  from?: 'due' | 'created';
}

export interface OperationsSettings {
  /** Minimum condition for a unit to count as ready for an arrival. */
  readinessCondition: Extract<UnitCondition, 'clean' | 'inspected'>;
  /** Create an inspection task when a cleaning task is completed. */
  inspectionAfterCleaning: boolean;
  /** Plan turndown service for in-house stays. */
  turndownEnabled: boolean;
  /** Housekeeping workload credits per task kind (integer points), with optional per-unit-type overrides. */
  credits: Partial<Record<TaskKind, number>>;
  creditsByUnitType: Record<string, Partial<Record<TaskKind, number>>>;
  /** Minutes of work per credit — used only for expected-completion estimates (shown as estimates). */
  minutesPerCredit: number;
  inspectionMinutes: number;
  /** An arrival whose ETA (or check-in time) is within this many minutes makes its unit "arrival due soon". */
  arrivalSoonMinutes: number;
  /** Default resolution time by priority for tasks without an explicit due time (minutes). */
  resolutionMinutes: Record<TaskPriority, number>;
  /** Kinds that get an automatic due time (others only escalate when a due time is set explicitly). */
  autoDueKinds: TaskKind[];
  /** Escalation path per department, measured from the task's due time. */
  escalation: Partial<Record<DepartmentKind, EscalationStep[]>> & { default: EscalationStep[] };
  /** Repeated do-not-disturb beyond this many hours creates a welfare-check task for the duty manager. */
  dndWelfareCheckHours: number;
  /** Work-order resolution time by urgency (minutes). */
  workOrderResolutionMinutes: Record<Urgency, number>;
  returnToService: {
    requireInspection: boolean;
    /** After maintenance the unit is set dirty and a cleaning task is created before inspection. */
    requireCleaning: boolean;
  };
  inspection: {
    /** Non-critical item failures tolerated before the inspection fails (critical failures always fail). */
    maxMinorFailures: number;
  };
  lostFound: { retentionDays: number; highValueRetentionDays: number };
  sync: {
    /** Client timestamps further in the future than this are clamped to server time (device clock drift). */
    maxClockSkewMinutes: number;
  };
}

export const DEFAULT_SETTINGS: OperationsSettings = {
  readinessCondition: 'inspected',
  inspectionAfterCleaning: true,
  turndownEnabled: false,
  credits: {
    departure_clean: 4,
    vacant_clean: 2,
    stayover: 2,
    turndown: 1,
    deep_clean: 8,
    inspection: 1,
    reclean: 2,
  },
  creditsByUnitType: {},
  minutesPerCredit: 10,
  inspectionMinutes: 10,
  arrivalSoonMinutes: 180,
  resolutionMinutes: { urgent: 15, high: 30, normal: 60, low: 240 },
  autoDueKinds: ['service_request', 'guest_commitment', 'work_order'],
  escalation: {
    default: [
      { from: 'created', afterMinutes: 15, target: 'supervisor' },
      { from: 'due', afterMinutes: 0, target: 'supervisor' },
      { from: 'due', afterMinutes: 30, target: 'department_head' },
    ],
  },
  dndWelfareCheckHours: 48,
  workOrderResolutionMinutes: { emergency: 60, high: 240, normal: 1440, low: 4320 },
  returnToService: { requireInspection: true, requireCleaning: true },
  inspection: { maxMinorFailures: 0 },
  lostFound: { retentionDays: 90, highValueRetentionDays: 180 },
  sync: { maxClockSkewMinutes: 5 },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge a (partial, untrusted) policy value onto the defaults. Arrays replace, objects merge. */
export function mergeSettings(
  override: unknown,
  base: OperationsSettings = DEFAULT_SETTINGS,
): OperationsSettings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined || b === null) return a;
    if (isRecord(a) && isRecord(b)) {
      const out: Record<string, unknown> = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
      return out;
    }
    return b;
  };
  return merge(base, override) as OperationsSettings;
}

export function creditsFor(settings: OperationsSettings, kind: TaskKind, unitTypeId?: string | null): number {
  const byType = unitTypeId ? settings.creditsByUnitType[unitTypeId]?.[kind] : undefined;
  return byType ?? settings.credits[kind] ?? 0;
}

export function escalationPathFor(settings: OperationsSettings, department: string): EscalationStep[] {
  const path = (settings.escalation as Record<string, EscalationStep[] | undefined>)[department];
  // Acknowledgement steps first, then overdue steps in time order.
  const rank = (st: EscalationStep) => (st.from === 'created' ? 0 : 1);
  return [...(path ?? settings.escalation.default)].sort(
    (a, b) => rank(a) - rank(b) || a.afterMinutes - b.afterMinutes,
  );
}

/**
 * Defaults by property profile (spec OPS-R05, §11): resorts and hotels plan turndown; a guesthouse collapses
 * attendant/supervisor/inspector and defaults inspection off (clean is enough for arrival).
 */
export function defaultsForProfile(profile: string | null | undefined): OperationsSettings {
  switch (profile) {
    case 'resort':
    case 'hotel':
    case 'boutique_hotel':
      return { ...DEFAULT_SETTINGS, turndownEnabled: true };
    case 'guesthouse':
    case 'hostel':
      return { ...DEFAULT_SETTINGS, readinessCondition: 'clean', inspectionAfterCleaning: false };
    default:
      return DEFAULT_SETTINGS;
  }
}
