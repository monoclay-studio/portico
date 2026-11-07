/**
 * Housekeeping workload balancing (credits/points model, research 02 §4.3 Stayntouch "points-based workload
 * balancing" and "auto task assignment by floor or section"). Produces SUGGESTIONS with explanations — a
 * supervisor accepts or changes them; nothing is assigned silently.
 */

export interface WorkloadTask {
  id: string;
  unitNumber: string | null;
  sectionId: string | null;
  /** Parent of the section (island zone / building), for "same zone" matching. */
  zoneId: string | null;
  sectionName: string | null;
  credits: number;
  priorityScore: number;
}

export interface WorkloadAttendant {
  id: string;
  name: string;
  homeSectionIds: readonly string[];
  homeZoneIds: readonly string[];
  capacity: number;
  /** Credits already assigned for the service date (before these suggestions). */
  assignedCredits: number;
  /** Sections where the attendant already has assigned work (keeps routes compact). */
  activeSectionIds: readonly string[];
}

export interface CandidateScore {
  attendantId: string;
  attendantName: string;
  score: number;
  loadAfter: number;
  capacity: number;
  factors: string[];
}

export interface AssignmentSuggestion {
  taskId: string;
  attendantId: string;
  attendantName: string;
  score: number;
  explanation: string[];
  alternatives: CandidateScore[];
}

export interface WorkloadSummary {
  attendantId: string;
  attendantName: string;
  capacity: number;
  creditsBefore: number;
  creditsAfter: number;
  utilisationPercent: number;
  suggestedTaskIds: string[];
}

export interface SuggestionResult {
  suggestions: AssignmentSuggestion[];
  unassigned: Array<{ taskId: string; reason: string }>;
  workload: WorkloadSummary[];
}

const W = { home: 40, zone: 20, cluster: 12, balance: 40, overCapacity: 100 } as const;

function scoreCandidate(
  task: WorkloadTask,
  a: WorkloadAttendant,
  state: { credits: number; sections: Set<string> },
): CandidateScore {
  let score = 0;
  const factors: string[] = [];
  if (task.sectionId && a.homeSectionIds.includes(task.sectionId)) {
    score += W.home;
    factors.push(`home section${task.sectionName ? ` ${task.sectionName}` : ''}`);
  } else if (task.zoneId && a.homeZoneIds.includes(task.zoneId)) {
    score += W.zone;
    factors.push('same zone as home section');
  }
  if (task.sectionId && state.sections.has(task.sectionId)) {
    score += W.cluster;
    factors.push('already working in this section');
  }
  const loadAfter = state.credits + task.credits;
  const ratio = a.capacity > 0 ? loadAfter / a.capacity : Number.POSITIVE_INFINITY;
  score -= Math.min(ratio, 2) * W.balance;
  factors.push(`load after ${loadAfter}/${a.capacity} credits (${Math.round(ratio * 100)}%)`);
  if (loadAfter > a.capacity) {
    score -= W.overCapacity;
    factors.push('over daily capacity');
  }
  return {
    attendantId: a.id,
    attendantName: a.name,
    score: Math.round(score * 10) / 10,
    loadAfter,
    capacity: a.capacity,
    factors,
  };
}

/**
 * Greedy, deterministic suggestion: highest-priority tasks are placed first, each with the best-scoring
 * attendant (home section, then zone, then compact route, balanced by load ratio). Ties break on lower load,
 * then name, then id, so the same input always yields the same suggestion.
 */
export function suggestAssignments(
  tasks: readonly WorkloadTask[],
  attendants: readonly WorkloadAttendant[],
): SuggestionResult {
  const state = new Map(
    attendants.map((a) => [a.id, { credits: a.assignedCredits, sections: new Set(a.activeSectionIds) }]),
  );
  const suggested = new Map<string, string[]>(attendants.map((a) => [a.id, []]));
  const ordered = [...tasks].sort(
    (x, y) =>
      y.priorityScore - x.priorityScore ||
      (x.sectionId ?? '').localeCompare(y.sectionId ?? '') ||
      (x.unitNumber ?? '').localeCompare(y.unitNumber ?? '', undefined, { numeric: true }) ||
      x.id.localeCompare(y.id),
  );
  const suggestions: AssignmentSuggestion[] = [];
  const unassigned: SuggestionResult['unassigned'] = [];
  for (const task of ordered) {
    if (!attendants.length) {
      unassigned.push({ taskId: task.id, reason: 'No attendants are on duty for this date.' });
      continue;
    }
    const candidates = attendants
      .map((a) => scoreCandidate(task, a, state.get(a.id) ?? { credits: 0, sections: new Set() }))
      .sort(
        (x, y) =>
          y.score - x.score ||
          x.loadAfter / x.capacity - y.loadAfter / y.capacity ||
          x.attendantName.localeCompare(y.attendantName) ||
          x.attendantId.localeCompare(y.attendantId),
      );
    const best = candidates[0];
    if (!best) continue;
    const s = state.get(best.attendantId);
    if (s) {
      s.credits = best.loadAfter;
      if (task.sectionId) s.sections.add(task.sectionId);
    }
    suggested.get(best.attendantId)?.push(task.id);
    const runnerUp = candidates[1];
    const explanation = [
      `${best.attendantName}: ${best.factors.join('; ')}.`,
      ...(runnerUp
        ? [`Next best: ${runnerUp.attendantName} (${runnerUp.factors.join('; ')}).`]
        : ['Only one attendant is on duty.']),
    ];
    suggestions.push({
      taskId: task.id,
      attendantId: best.attendantId,
      attendantName: best.attendantName,
      score: best.score,
      explanation,
      alternatives: candidates.slice(1, 4),
    });
  }
  const workload = attendants.map((a) => {
    const after = state.get(a.id)?.credits ?? a.assignedCredits;
    return {
      attendantId: a.id,
      attendantName: a.name,
      capacity: a.capacity,
      creditsBefore: a.assignedCredits,
      creditsAfter: after,
      utilisationPercent: a.capacity > 0 ? Math.round((after / a.capacity) * 100) : 0,
      suggestedTaskIds: suggested.get(a.id) ?? [],
    };
  });
  return { suggestions, unassigned, workload };
}
