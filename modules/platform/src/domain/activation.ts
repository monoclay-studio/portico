import type { EffectMode, ExternalEffect } from '@portico/kernel';

/**
 * Property activation stages and activation scope (adoption brief §3 stages 4–5, §11; gap G-04;
 * docs/adoption/evaluation-and-trial.md §6).
 *
 * Status machine: setup → pilot → active → inactive, plus pilot → setup (pilot stopped) and setup → active.
 * `active → setup` is forbidden; `inactive → active` is a Monoclay-operator action (not offered here).
 * Entering `pilot` or `active` needs an approval by a different person holding `platform.property.activate`.
 *
 * Activation scope = what may have real-world effect at a property in the `live` environment:
 *  - setup:    no live external effects except `integration.read` (the integration module additionally requires
 *              the connection itself to be approved read-only — G-03);
 *  - pilot:    only effects (optionally per connection and workflow) listed in the approved pilot scope, within
 *              its window;
 *  - active:   the approved production scope (by default every effect);
 *  - inactive: nothing but `integration.read` (history look-ups).
 * In non-live environments the kernel environment policy already simulates or blocks effects; the scope adds
 * nothing there, so effects whose mode is not `live` always pass the scope check.
 */
export type PropertyStatus = 'setup' | 'pilot' | 'active' | 'inactive';
export type ScopeStage = 'pilot' | 'production';

export const ALL_EFFECTS: readonly ExternalEffect[] = [
  'payment.charge',
  'message.guest',
  'message.staff',
  'channel.publish',
  'government.submit',
  'ai.inference',
  'credentials.production',
  'access.key',
  'integration.read',
  'integration.write',
];

/** One permitted effect, optionally narrowed to connections and workflows (empty/absent = any). */
export interface ScopedEffect {
  effect: ExternalEffect;
  connectionIds?: string[];
  workflows?: string[];
}

/** The approved scope document (stored versioned; a change is a new version with approval). */
export interface ActivationScopeContent {
  /** Effects allowed live. `allEffects` (production default) allows every effect. */
  allEffects?: boolean;
  effects: ScopedEffect[];
  /** Workflows live at the property, as `<module>.<workflow>` keys (e.g. `operations.housekeepingBoard`). */
  workflows: string[];
  /** Modules live at the property (informational for the pilot plan; workflows are what is enforced). */
  modules: string[];
  /** Staff who take part in the pilot (informational; enforcement is through their role assignments). */
  participantUserIds?: string[];
  /** Pilot window (property-local dates, inclusive). */
  startsOn?: string;
  endsOn?: string;
  successCriteria?: string;
  rollbackPlan?: string;
  guestScope?: string;
  supportContacts?: string;
}

export const DEFAULT_PRODUCTION_SCOPE: ActivationScopeContent = {
  allEffects: true,
  effects: [],
  workflows: ['*'],
  modules: ['*'],
};

const TRANSITIONS: Record<PropertyStatus, readonly PropertyStatus[]> = {
  setup: ['pilot', 'active'],
  pilot: ['active', 'setup'],
  active: ['inactive'],
  inactive: [],
};

export function canTransition(from: PropertyStatus, to: PropertyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Transitions that need a separate approver with `platform.property.activate`. */
export function requiresApproval(to: PropertyStatus): boolean {
  return to === 'pilot' || to === 'active';
}

export type EffectDecision =
  | { allowed: true; reason: 'not_live_mode' | 'in_scope' }
  | {
      allowed: false;
      reason:
        | 'setup_allows_reads_only'
        | 'inactive_property'
        | 'no_approved_scope'
        | 'outside_pilot_window'
        | 'effect_not_in_scope'
        | 'connection_not_in_scope'
        | 'workflow_not_in_scope';
    };

/**
 * Decide whether an effect may happen at a property. `mode` is the kernel environment mode for the effect
 * (`effectMode(ctx, effect)`); `today` is the property's business/local date used for the pilot window.
 */
export function decideEffect(input: {
  status: PropertyStatus;
  mode: EffectMode;
  effect: ExternalEffect;
  scope: ActivationScopeContent | null;
  today: string;
  connectionId?: string | undefined;
  workflow?: string | undefined;
}): EffectDecision {
  if (input.mode !== 'live') return { allowed: true, reason: 'not_live_mode' };
  if (input.status === 'setup') {
    return input.effect === 'integration.read'
      ? { allowed: true, reason: 'in_scope' }
      : { allowed: false, reason: 'setup_allows_reads_only' };
  }
  if (input.status === 'inactive') {
    return input.effect === 'integration.read'
      ? { allowed: true, reason: 'in_scope' }
      : { allowed: false, reason: 'inactive_property' };
  }
  const scope = input.scope ?? (input.status === 'active' ? DEFAULT_PRODUCTION_SCOPE : null);
  if (!scope) return { allowed: false, reason: 'no_approved_scope' };
  if (input.status === 'pilot') {
    if (scope.startsOn && input.today < scope.startsOn)
      return { allowed: false, reason: 'outside_pilot_window' };
    if (scope.endsOn && input.today > scope.endsOn) return { allowed: false, reason: 'outside_pilot_window' };
  }
  if (scope.allEffects) return { allowed: true, reason: 'in_scope' };
  const entries = scope.effects.filter((e) => e.effect === input.effect);
  if (entries.length === 0) return { allowed: false, reason: 'effect_not_in_scope' };
  const connectionOk = entries.filter(
    (e) =>
      !e.connectionIds?.length ||
      (input.connectionId !== undefined && e.connectionIds.includes(input.connectionId)),
  );
  if (connectionOk.length === 0) return { allowed: false, reason: 'connection_not_in_scope' };
  const workflowOk = connectionOk.some(
    (e) => !e.workflows?.length || (input.workflow !== undefined && e.workflows.includes(input.workflow)),
  );
  if (!workflowOk) return { allowed: false, reason: 'workflow_not_in_scope' };
  return { allowed: true, reason: 'in_scope' };
}

/** Whether a workflow is live at a property (pilot: listed in scope; active: production scope; setup: dry runs). */
export function decideWorkflow(input: {
  status: PropertyStatus;
  scope: ActivationScopeContent | null;
  workflow: string;
  today: string;
}): { allowed: boolean; reason: string } {
  if (input.status === 'setup') return { allowed: true, reason: 'setup_no_live_effects' };
  if (input.status === 'inactive') return { allowed: false, reason: 'inactive_property' };
  const scope = input.scope ?? (input.status === 'active' ? DEFAULT_PRODUCTION_SCOPE : null);
  if (!scope) return { allowed: false, reason: 'no_approved_scope' };
  if (input.status === 'pilot') {
    if (scope.startsOn && input.today < scope.startsOn)
      return { allowed: false, reason: 'outside_pilot_window' };
    if (scope.endsOn && input.today > scope.endsOn) return { allowed: false, reason: 'outside_pilot_window' };
  }
  const module = input.workflow.split('.')[0] ?? '';
  const ok =
    scope.workflows.includes('*') ||
    scope.workflows.includes(input.workflow) ||
    scope.workflows.includes(`${module}.*`);
  return ok ? { allowed: true, reason: 'in_scope' } : { allowed: false, reason: 'workflow_not_in_scope' };
}

/** Problems with a proposed scope document (blockers prevent approval). */
export function validateScope(stage: ScopeStage, s: ActivationScopeContent): string[] {
  const problems: string[] = [];
  if (stage === 'pilot') {
    if (s.allEffects)
      problems.push('A pilot scope must list its effects explicitly; "all effects" is for production.');
    if (!s.startsOn || !s.endsOn) problems.push('A pilot needs a start and end date.');
    if (s.startsOn && s.endsOn && s.endsOn < s.startsOn) problems.push('The pilot ends before it starts.');
    if (!s.successCriteria?.trim()) problems.push('Record the success criteria the pilot will be judged by.');
    if (!s.rollbackPlan?.trim()) problems.push('Record how the pilot is rolled back if it fails.');
    if (s.workflows.includes('*')) problems.push('A pilot must name the workflows that go live, not "all".');
  }
  const seen = new Set<string>();
  for (const e of s.effects) {
    if (!ALL_EFFECTS.includes(e.effect)) problems.push(`Unknown effect "${e.effect}".`);
    if (seen.has(e.effect))
      problems.push(`Effect "${e.effect}" is listed twice; merge its connections/workflows.`);
    seen.add(e.effect);
  }
  return problems;
}

/** Checklist item contributed by platform or another module (PLT-R14). */
export interface ChecklistItem {
  key: string;
  label: string;
  level: 'blocker' | 'warning';
  passed: boolean;
  detail?: string;
}

export function checklistBlocks(items: readonly ChecklistItem[]): boolean {
  return items.some((i) => i.level === 'blocker' && !i.passed);
}
