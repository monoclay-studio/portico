/**
 * Events emitted by day-close (outbox, `<module>.<aggregate>.<pastTenseVerb>`). Payloads carry ids, dates and
 * counts only — never guest names. `notification` tells comms (when bound) who to tell and how: `simulate` in
 * non-live organizations (rule 12).
 */
export const DAY_CLOSE_EVENTS = {
  runStarted: 'dayClose.run.started',
  runBlocked: 'dayClose.run.blocked',
  runFailed: 'dayClose.run.failed',
  runCompleted: 'dayClose.run.completed',
  runCancelled: 'dayClose.run.cancelled',
  stepCompleted: 'dayClose.step.completed',
  /** After the business date advanced: operations plans stayovers, analytics reads the frozen facts. */
  dayClosed: 'dayClose.day.closed',
} as const;

export type DayCloseEventType = (typeof DAY_CLOSE_EVENTS)[keyof typeof DAY_CLOSE_EVENTS];

export interface RunEventPayload {
  runId: string;
  propertyId: string;
  businessDate: string;
  [key: string]: unknown;
}

export interface DayClosedPayload extends RunEventPayload {
  newBusinessDate: string;
  factsRef: { type: 'day_facts'; propertyId: string; businessDate: string };
}

/** Consumed: none yet (platform's businessDateAdvanced is the advance step's own effect, in the same transaction). */
export const DAY_CLOSE_CONSUMES = [] as const;
