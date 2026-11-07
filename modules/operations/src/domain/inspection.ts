import { ValidationError } from '@portico/kernel';

export interface ChecklistItemDefinition {
  code: string;
  label: string;
  /** A critical item failing always fails the inspection. */
  critical: boolean;
  area?: string;
}

export interface ChecklistItemResult {
  code: string;
  result: 'pass' | 'fail' | 'na';
  note?: string | null;
  photoRefs?: string[];
}

export interface InspectionFailure {
  code: string;
  label: string;
  critical: boolean;
  note: string | null;
  photoRefs: string[];
}

export interface InspectionEvaluation {
  result: 'passed' | 'failed';
  failures: InspectionFailure[];
  /** Short human reasons, e.g. "Bathroom: hair in shower drain". */
  reasons: string[];
  items: Array<ChecklistItemResult & { label: string; critical: boolean }>;
}

/**
 * Evaluate an inspection against a checklist template (or ad-hoc reasons when the property has no template).
 * Every template item must be answered — an inspection never passes because items were skipped.
 */
export function evaluateInspection(input: {
  template: readonly ChecklistItemDefinition[] | null;
  items: readonly ChecklistItemResult[];
  adHocFailureReasons?: readonly string[];
  maxMinorFailures: number;
}): InspectionEvaluation {
  const seen = new Set<string>();
  for (const i of input.items) {
    if (seen.has(i.code))
      throw new ValidationError(
        'duplicate_checklist_item',
        `Checklist item "${i.code}" was answered twice.`,
        {
          code: i.code,
        },
      );
    seen.add(i.code);
  }
  const defs = new Map((input.template ?? []).map((d) => [d.code, d]));
  if (input.template) {
    const unknown = input.items.filter((i) => !defs.has(i.code)).map((i) => i.code);
    if (unknown.length)
      throw new ValidationError(
        'unknown_checklist_item',
        `These items are not on the checklist: ${unknown.join(', ')}. Refresh the checklist and try again.`,
        { unknown },
      );
    const missing = input.template.filter((d) => !seen.has(d.code)).map((d) => d.label);
    if (missing.length)
      throw new ValidationError(
        'checklist_incomplete',
        `Answer every checklist item before recording the inspection. Missing: ${missing.join(', ')}.`,
        { missing },
      );
  }
  const items = input.items.map((i) => {
    const d = defs.get(i.code);
    return { ...i, label: d?.label ?? i.code, critical: d?.critical ?? true };
  });
  const failures: InspectionFailure[] = items
    .filter((i) => i.result === 'fail')
    .map((i) => ({
      code: i.code,
      label: i.label,
      critical: i.critical,
      note: i.note ?? null,
      photoRefs: i.photoRefs ?? [],
    }));
  for (const [n, reason] of (input.adHocFailureReasons ?? []).entries()) {
    failures.push({ code: `ad_hoc_${n + 1}`, label: reason, critical: true, note: null, photoRefs: [] });
  }
  const critical = failures.filter((f) => f.critical).length;
  const minor = failures.length - critical;
  const failed = critical > 0 || minor > input.maxMinorFailures;
  return {
    result: failed ? 'failed' : 'passed',
    failures,
    reasons: failures.map((f) => (f.note ? `${f.label}: ${f.note}` : f.label)),
    items,
  };
}

// ───────────────────────────── Return to service ─────────────────────────────

export interface ReturnToServiceInput {
  policy: { requireWorkOrderCompletion: boolean; requireInspection: boolean };
  workOrderCompletedAt: Date | null;
  /** Most recent passed inspection of the unit. */
  lastPassedInspectionAt: Date | null;
  blockActive: boolean;
}

export interface ReturnToServiceCheck {
  allowed: boolean;
  missing: Array<{
    code: 'work_order_not_completed' | 'inspection_not_passed' | 'no_active_block';
    message: string;
  }>;
}

/**
 * A unit returns to sale only when its maintenance is finished and (by policy) a passed inspection AFTER the
 * work was completed is on record (brief §8: returning it to sale must respect required maintenance and
 * inspection steps).
 */
export function checkReturnToService(input: ReturnToServiceInput): ReturnToServiceCheck {
  const missing: ReturnToServiceCheck['missing'] = [];
  if (!input.blockActive) {
    missing.push({
      code: 'no_active_block',
      message: 'The unit has no active out-of-order or out-of-service block.',
    });
  }
  if (input.policy.requireWorkOrderCompletion && !input.workOrderCompletedAt) {
    missing.push({
      code: 'work_order_not_completed',
      message: 'The work order is not completed. Record the repair (resolution note) first.',
    });
  }
  if (input.policy.requireInspection) {
    const after = input.workOrderCompletedAt;
    const ok =
      input.lastPassedInspectionAt !== null &&
      (after === null || input.lastPassedInspectionAt.getTime() >= after.getTime());
    if (!ok) {
      missing.push({
        code: 'inspection_not_passed',
        message:
          'The unit needs a passed inspection after the repair was completed. Inspect it, then return it to service.',
      });
    }
  }
  return { allowed: missing.length === 0, missing };
}
