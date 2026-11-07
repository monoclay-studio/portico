/**
 * Events migration emits (outbox) and consumes. Emitted payloads carry ids and statuses only — never personal data.
 */
import type { TxEventSubscription } from '@portico/db';
import { z } from 'zod';
import { JOURNALED_EVENTS, journalEvent } from './service/cutover';

export const MIGRATION_EVENTS = {
  jobCreated: 'migration.job.created',
  jobCompleted: 'migration.job.completed',
  extractTaken: 'migration.extract.taken',
  stepSucceeded: 'migration.step.succeeded',
  stepWaiting: 'migration.step.waiting',
  stepFailed: 'migration.step.failed',
  reconciliationCompleted: 'migration.reconciliation.completed',
  rehearsalCertified: 'migration.rehearsal.certified',
  checklistCompleted: 'migration.checklist.completed',
  checklistReminderDue: 'migration.checklist.reminderDue',
  productionAuthorized: 'migration.production.authorized',
  cutoverPlanned: 'migration.cutover.planned',
  cutoverFrozen: 'migration.cutover.frozen',
  cutoverSwitched: 'migration.cutover.switched',
  cutoverVerified: 'migration.cutover.verified',
  rollbackRequested: 'migration.rollback.requested',
  cutoverRolledBack: 'migration.cutover.rolledBack',
  exceptionResolved: 'migration.exception.resolved',
} as const;

/** For comms: who to remind about which checklist step (ids and roles only). */
export const checklistReminderPayload = z.object({
  jobId: z.uuid(),
  key: z.string(),
  title: z.string(),
  ownerRole: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  dueAt: z.string(),
  reminders: z.number().int(),
});

export const cutoverSwitchedPayload = z.object({ jobId: z.uuid(), domains: z.array(z.string()) });
export const cutoverVerifiedPayload = z.object({
  jobId: z.uuid(),
  freezeMinutes: z.number().nullable(),
  reportId: z.uuid(),
});

/**
 * Cutover journal: every business change at a property between the switch and the end of the rollback window is
 * recorded as a worklist entry (acceptance criteria §9.3). Idempotent per event.
 */
export function migrationSubscriptions(): TxEventSubscription[] {
  return [
    {
      consumer: 'migration.cutoverJournal',
      types: JOURNALED_EVENTS,
      async handle(tx, event) {
        await journalEvent(tx, event);
      },
    },
  ];
}
