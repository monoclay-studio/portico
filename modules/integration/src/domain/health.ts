/**
 * Connection health (adoption brief §9; connection lifecycle spec §6; INT-R21/R22; gap G-05).
 *
 * Per workflow, against its declared FRESHNESS TARGET T:
 *   healthy  — last success within T, no failures
 *   delayed  — last success older than T but within 3×T (data labeled `delayed` with its age)
 *   degraded — errors on part of the traffic, held messages, or older than 3×T for a workflow that does not
 *              feed a system-of-record domain
 *   failing  — older than 3×T for a workflow feeding a system-of-record domain, or circuit breaker open
 *   paused / unknown (no data yet)
 * A detected gap makes the workflow's data `incomplete` until a reconciliation clears it.
 * Connection overall: healthy | degraded | down | paused | not_monitored, with URGENT problems separated from
 * ROUTINE information (spec §6.4). INT-I08: never healthy when the last success is older than the target.
 * Pure logic — no IO.
 */
import type {
  ConnectionState,
  HealthSignal,
  HealthStatus,
  ResponsibleParty,
  Severity,
  SyncMode,
  WorkflowHealth,
  WorkflowHealthStatus,
  WorkflowOperation,
} from '../contracts';
import { workflowInfo } from './impact';
import { isOperational } from './setup-journey';

/** Consecutive failures after which the circuit breaker opens (spec §8.2). */
export const CIRCUIT_BREAKER_THRESHOLD = 10;
/** Credential reminders (INT-R08): routine from 30 days, urgent from 1 day, urgent exception at expiry. */
export const CREDENTIAL_REMINDER_DAYS = 30;
export const CREDENTIAL_URGENT_DAYS = 1;
export const VENDOR_NOTICE_URGENT_DAYS = 7;
const DAY_MS = 86_400_000;

export interface WorkflowHealthInput {
  workflow: string;
  sync: SyncMode;
  operations: readonly WorkflowOperation[];
  freshnessTargetSeconds: number | null;
  expectedIntervalSeconds: number | null;
  /** True when this connection is the system of record for the workflow's domain. */
  feedsSystemOfRecord: boolean;
  lastSuccessAt: Date | null;
  lastFailureKind: string | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  lastMessageLatencySeconds: number | null;
  incompleteSince: Date | null;
  incompleteReason: string | null;
  heldMessages: number;
}

export interface HealthInput {
  now: Date;
  state: ConnectionState;
  systemName: string;
  /** Base label of data from this connection when fresh. */
  baseProvenance: 'external' | 'simulated';
  activatedAt: Date | null;
  interruptedSince: Date | null;
  interruptionReason: string | null;
  workflows: readonly WorkflowHealthInput[];
  credential: { required: boolean; present: boolean; expiresAt: Date | null; rejected: boolean };
  mappingProblems: { awaitingReview: number; unmapped: number };
  outbound: { queued: number; pendingVerification: number; needsRevalidation: number };
  openExceptions: ReadonlyArray<{
    severity: Severity;
    code: string;
    problem: string;
    nextStep: string;
    responsibleParty: ResponsibleParty;
    workflow: string | null;
  }>;
  vendorNotices: ReadonlyArray<{
    title: string;
    requiredAction: string;
    dueDate: string | null;
    responsibleParty: ResponsibleParty;
  }>;
}

export interface HealthResult {
  overall: HealthStatus;
  reason: string | null;
  worstWorkflowStatus: WorkflowHealthStatus;
  credentialStatus: 'ok' | 'expiring' | 'invalid' | 'not_required';
  urgent: HealthSignal[];
  routine: HealthSignal[];
  workflows: WorkflowHealth[];
  daysToExpiry: number | null;
  recoveryActions: string[];
}

export function humanDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

function partyForFailure(kind: string | null): ResponsibleParty {
  if (kind === 'auth') return 'hotel';
  if (kind === 'outage' || kind === 'rate_limited' || kind === 'timeout') return 'vendor';
  return 'monoclay';
}

function nextStepForFailure(kind: string | null, systemName: string): string {
  switch (kind) {
    case 'auth':
      return `Ask the ${systemName} administrator for a new credential and rotate it in Portico. Held work is checked before anything is sent.`;
    case 'outage':
    case 'timeout':
      return `Portico retries automatically. If it lasts, check ${systemName}'s status and contact its support; work in ${systemName} directly meanwhile.`;
    case 'rate_limited':
      return 'Portico slows down and retries automatically. No action needed unless it continues.';
    default:
      return 'Monoclay support follows this from the exception list; no hotel action is needed yet.';
  }
}

export function exchangeLabel(sync: SyncMode, expectedIntervalSeconds: number | null): string {
  switch (sync) {
    case 'realtime':
      return 'Live connection';
    case 'periodic':
      return expectedIntervalSeconds
        ? `Updated every ${humanDuration(expectedIntervalSeconds)}`
        : 'Updated periodically';
    case 'manual':
      return 'Updated when someone presses Sync';
    case 'file':
      return 'File exchange — not a live connection';
  }
}

const STATUS_RANK: Record<WorkflowHealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  paused: 2,
  delayed: 3,
  degraded: 4,
  failing: 5,
};

export function classifyWorkflow(
  w: WorkflowHealthInput,
  ctx: { now: Date; operational: boolean; paused: boolean; activatedAt: Date | null },
): { status: WorkflowHealthStatus; ageSeconds: number | null } {
  const age = w.lastSuccessAt
    ? Math.max(0, Math.round((ctx.now.getTime() - w.lastSuccessAt.getTime()) / 1000))
    : null;
  if (ctx.paused) return { status: 'paused', ageSeconds: age };
  if (!ctx.operational) return { status: 'unknown', ageSeconds: age };
  if (w.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) return { status: 'failing', ageSeconds: age };
  const T = w.sync === 'periodic' || w.sync === 'realtime' ? w.freshnessTargetSeconds : null;
  if (age === null) {
    const activeFor = ctx.activatedAt
      ? Math.round((ctx.now.getTime() - ctx.activatedAt.getTime()) / 1000)
      : 0;
    if (T !== null && activeFor > 3 * T) {
      return { status: w.feedsSystemOfRecord ? 'failing' : 'degraded', ageSeconds: null };
    }
    return { status: w.consecutiveFailures > 0 ? 'degraded' : 'unknown', ageSeconds: null };
  }
  if (T !== null && age > 3 * T)
    return { status: w.feedsSystemOfRecord ? 'failing' : 'degraded', ageSeconds: age };
  if (w.consecutiveFailures > 0 || w.heldMessages > 0) return { status: 'degraded', ageSeconds: age };
  if (T !== null && age > T) return { status: 'delayed', ageSeconds: age };
  if (T !== null && w.lastMessageLatencySeconds !== null && w.lastMessageLatencySeconds > T) {
    return { status: 'delayed', ageSeconds: age };
  }
  return { status: 'healthy', ageSeconds: age };
}

export function computeHealth(input: HealthInput): HealthResult {
  const urgent: HealthSignal[] = [];
  const routine: HealthSignal[] = [];
  const recovery = new Set<string>();
  const add = (s: HealthSignal) => {
    const list = s.severity === 'urgent' ? urgent : routine;
    if (!list.some((x) => x.code === s.code && x.workflow === s.workflow)) list.push(s);
  };
  const operational = isOperational(input.state);
  const paused = input.state === 'paused';
  const monitored = operational || paused || input.state === 'error';
  const now = input.now.getTime();
  const sys = input.systemName;

  // ── Credential ──
  let daysToExpiry: number | null = null;
  let credentialStatus: HealthResult['credentialStatus'] = input.credential.required ? 'ok' : 'not_required';
  if (input.credential.expiresAt) {
    const ms = input.credential.expiresAt.getTime() - now;
    daysToExpiry = Math.floor(ms / DAY_MS);
    if (ms <= 0) {
      credentialStatus = 'invalid';
      add({
        code: 'credential_expired',
        severity: 'urgent',
        title: `The credential for ${sys} has expired`,
        detail: `Portico cannot exchange information with ${sys} until a new credential is added. Information shown from ${sys} is getting older.`,
        workflow: null,
        responsibleParty: 'hotel',
        nextStep: `Get a new credential from ${sys} and rotate it in Portico. Held work is checked before anything is sent.`,
      });
      recovery.add('Rotate the credential');
    } else if (ms <= CREDENTIAL_REMINDER_DAYS * DAY_MS) {
      credentialStatus = 'expiring';
      const days = Math.max(0, daysToExpiry);
      add({
        code: 'credential_expiring',
        severity: ms <= CREDENTIAL_URGENT_DAYS * DAY_MS ? 'urgent' : 'routine',
        title: `The credential for ${sys} expires in ${days} day${days === 1 ? '' : 's'}`,
        detail: `On ${input.credential.expiresAt.toISOString().slice(0, 10)} the connection stops working unless the credential is renewed.`,
        workflow: null,
        responsibleParty: 'hotel',
        nextStep: `Request a new credential from ${sys} and rotate it before it expires.`,
      });
      recovery.add('Rotate the credential');
    }
  }
  if (input.credential.rejected && credentialStatus !== 'not_required') {
    credentialStatus = 'invalid';
    add({
      code: 'credential_rejected',
      severity: 'urgent',
      title: `${sys} no longer accepts Portico's credential`,
      detail: 'Reads have stopped and actions for it are held (not sent, not lost).',
      workflow: null,
      responsibleParty: 'hotel',
      nextStep: `Ask the ${sys} administrator to renew Portico's access, then rotate the credential. Held work is checked before anything is sent.`,
    });
    recovery.add('Rotate the credential');
  } else if (input.credential.required && !input.credential.present && monitored) {
    credentialStatus = 'invalid';
    add({
      code: 'credential_missing',
      severity: 'urgent',
      title: `No active credential for ${sys}`,
      detail: 'The connection cannot authenticate.',
      workflow: null,
      responsibleParty: 'hotel',
      nextStep: 'Add a credential (rotate) to restore the connection.',
    });
  }

  // ── Workflows ──
  const workflows: WorkflowHealth[] = input.workflows.map((w) => {
    const info = workflowInfo(w.workflow);
    const { status, ageSeconds } = classifyWorkflow(w, {
      now: input.now,
      operational,
      paused,
      activatedAt: input.activatedAt,
    });
    const T = w.sync === 'periodic' || w.sync === 'realtime' ? w.freshnessTargetSeconds : null;
    const stale = T !== null && ageSeconds !== null && ageSeconds > T;
    const provenance = w.incompleteSince
      ? 'incomplete'
      : stale || (monitored && status === 'failing')
        ? 'delayed'
        : input.baseProvenance;
    if (operational && (status === 'failing' || status === 'degraded' || status === 'delayed')) {
      const sev: Severity =
        status === 'failing' || (status === 'degraded' && info.critical) ? 'urgent' : 'routine';
      const lastOk =
        ageSeconds !== null
          ? `Last successful exchange ${humanDuration(ageSeconds)} ago`
          : 'No successful exchange yet';
      const target = T !== null ? ` (target: within ${humanDuration(T)})` : '';
      const err = w.lastFailureReason ? ` Last problem: ${w.lastFailureReason}` : '';
      const held = w.heldMessages > 0 ? ` ${w.heldMessages} update(s) are held for review.` : '';
      add({
        code: `workflow_${status}`,
        severity: sev,
        title:
          status === 'failing'
            ? `${info.label} from ${sys} are not updating`
            : status === 'degraded'
              ? `${info.label} with ${sys} have problems`
              : `${info.label} from ${sys} are delayed`,
        detail: `${lastOk}${target}.${held}${err}`,
        workflow: w.workflow,
        responsibleParty:
          w.heldMessages > 0 && w.consecutiveFailures === 0 ? 'hotel' : partyForFailure(w.lastFailureKind),
        nextStep:
          w.heldMessages > 0 && w.consecutiveFailures === 0
            ? 'Review the mappings; held updates are applied automatically once the codes are mapped.'
            : nextStepForFailure(w.lastFailureKind, sys),
      });
      recovery.add(w.heldMessages > 0 ? 'Review mappings' : 'Retry now');
    }
    if (monitored && w.incompleteSince) {
      add({
        code: 'workflow_incomplete',
        severity: info.critical ? 'urgent' : 'routine',
        title: `${info.label} from ${sys} may be incomplete`,
        detail: w.incompleteReason ?? 'A missed update was detected.',
        workflow: w.workflow,
        responsibleParty: 'monoclay',
        nextStep: 'Run a reconciliation to fetch what was missed. Lists stay labeled incomplete until then.',
      });
      recovery.add('Reconcile now');
    }
    return {
      workflow: w.workflow,
      label: info.label,
      status,
      sync: w.sync,
      exchangeLabel: exchangeLabel(w.sync, w.expectedIntervalSeconds),
      lastSuccessAt: w.lastSuccessAt ? w.lastSuccessAt.toISOString() : null,
      ageSeconds,
      freshnessTargetSeconds: T,
      dataProvenance: provenance,
      incompleteSince: w.incompleteSince ? w.incompleteSince.toISOString() : null,
      incompleteReason: w.incompleteReason,
      lastMessageLatencySeconds: w.lastMessageLatencySeconds,
      consecutiveFailures: w.consecutiveFailures,
      feedsSystemOfRecord: w.feedsSystemOfRecord,
    };
  });

  if (operational && input.interruptedSince) {
    add({
      code: 'connection_interrupted',
      severity: 'urgent',
      title: `Exchange with ${sys} is interrupted`,
      detail: `Since ${input.interruptedSince.toISOString()}: ${input.interruptionReason ?? 'repeated failures'}. Money and inventory actions are not being sent.`,
      workflow: null,
      responsibleParty: partyForFailure(
        input.workflows.find((w) => w.consecutiveFailures > 0)?.lastFailureKind ?? null,
      ),
      nextStep:
        'Portico keeps trying. When the connection returns, review the actions held for confirmation.',
    });
  }

  if (monitored && (input.mappingProblems.awaitingReview > 0 || input.mappingProblems.unmapped > 0)) {
    const n = input.mappingProblems.awaitingReview + input.mappingProblems.unmapped;
    add({
      code: 'mappings_need_review',
      severity: 'routine',
      title: `${n} mapping${n === 1 ? '' : 's'} need review`,
      detail: `${sys} uses codes that are not yet confirmed in Portico.`,
      workflow: null,
      responsibleParty: 'hotel',
      nextStep: 'Open the mappings and confirm or correct them.',
    });
    recovery.add('Review mappings');
  }

  if (input.outbound.needsRevalidation > 0) {
    const n = input.outbound.needsRevalidation;
    add({
      code: 'actions_need_revalidation',
      severity: 'urgent',
      title: `${n} action${n === 1 ? '' : 's'} for ${sys} wait for your decision`,
      detail:
        'They involve money or inventory and were held while the systems were apart. Portico will not send them again by itself.',
      workflow: null,
      responsibleParty: 'hotel',
      nextStep:
        'Check each action against the guest bill or availability, then resend or cancel it. Resending checks with the other system first.',
    });
    recovery.add('Review held actions');
  }
  if (input.outbound.pendingVerification > 0) {
    const n = input.outbound.pendingVerification;
    add({
      code: 'actions_pending_verification',
      severity: 'urgent',
      title: `${n} action${n === 1 ? '' : 's'} have an unknown outcome`,
      detail: `${sys} did not confirm whether it applied them. They show as pending verification, never as done.`,
      workflow: null,
      responsibleParty: 'vendor',
      nextStep: `Portico checks with ${sys} before doing anything else. No action needed unless this lasts.`,
    });
  }

  for (const e of input.openExceptions) {
    add({
      code: `exception:${e.code}`,
      severity: e.severity,
      title: e.problem,
      detail: e.nextStep,
      workflow: e.workflow,
      responsibleParty: e.responsibleParty,
      nextStep: e.nextStep,
    });
  }
  for (const n of input.vendorNotices) {
    const due = n.dueDate ? Date.parse(`${n.dueDate}T00:00:00Z`) : null;
    const soon = due !== null && due - now <= VENDOR_NOTICE_URGENT_DAYS * DAY_MS;
    add({
      code: `vendor_notice:${n.title}`,
      severity: soon ? 'urgent' : 'routine',
      title: n.title,
      detail: n.dueDate ? `Required by ${n.dueDate}.` : 'No deadline announced.',
      workflow: null,
      responsibleParty: n.responsibleParty,
      nextStep: n.requiredAction,
    });
  }

  const worstWorkflowStatus = workflows.reduce<WorkflowHealthStatus>(
    (worst, w) => (STATUS_RANK[w.status] > STATUS_RANK[worst] ? w.status : worst),
    workflows.length > 0 ? 'healthy' : 'unknown',
  );

  let overall: HealthStatus;
  let reason: string | null = null;
  if (paused) {
    overall = 'paused';
    reason = 'Paused by a person; nothing is exchanged until it is resumed.';
    recovery.add('Resume the connection');
  } else if (!monitored) {
    overall = 'not_monitored';
  } else {
    const timeBound = workflows.filter((w) => w.freshnessTargetSeconds !== null);
    const allFailing = timeBound.length > 0 && timeBound.every((w) => w.status === 'failing');
    if (input.state === 'error' || credentialStatus === 'invalid' || allFailing) {
      overall = 'down';
      reason =
        credentialStatus === 'invalid'
          ? `${sys} no longer accepts Portico's credential.`
          : input.state === 'error'
            ? 'The connection is suspended and needs attention.'
            : `No workflow with ${sys} is succeeding.`;
    } else if (urgent.length > 0 || STATUS_RANK[worstWorkflowStatus] >= STATUS_RANK.delayed) {
      overall = 'degraded';
      reason = urgent[0]?.title ?? routine[0]?.title ?? null;
    } else {
      overall = 'healthy';
    }
  }
  return {
    overall,
    reason,
    worstWorkflowStatus,
    credentialStatus,
    urgent,
    routine,
    workflows,
    daysToExpiry,
    recoveryActions: [...recovery],
  };
}
