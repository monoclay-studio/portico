import { DomainError } from '@portico/kernel';
import type { ChangePreview } from './contracts';
import type { FieldChange } from './domain/diff';

/**
 * The change the user previewed is no longer what would happen (RES-I07): availability, prices, penalties or the
 * booking itself changed. Carries a FRESH preview and the differences so the user can re-confirm knowingly.
 */
export class PreviewStaleError extends DomainError {
  constructor(input: {
    reason: string;
    freshPreview: ChangePreview | null;
    differences: FieldChange[];
    explanation?: string[];
  }) {
    super(
      'preview_stale',
      `${input.reason} Nothing was changed. Review the updated preview and confirm again if it is still what you want.`,
      {
        status: 409,
        details: {
          reason: input.reason,
          freshPreview: input.freshPreview,
          differences: input.differences,
          explanation: input.explanation ?? [],
        },
      },
    );
  }
}

/** Booking aggregate version conflict with a field-level diff and who changed it (S14, RES-R13). */
export class BookingVersionConflictError extends DomainError {
  constructor(input: {
    bookingId: string;
    expectedVersion: number;
    currentVersion: number;
    changes: FieldChange[];
    changedBy: Array<{ version: number; actor: string; action: string; at: string }>;
  }) {
    const who = [...new Set(input.changedBy.map((c) => c.actor))].join(', ') || 'someone else';
    super(
      'version_conflict',
      `This booking was changed by ${who} while you were editing (you had version ${input.expectedVersion}, it is now ${input.currentVersion}). Your change was not saved. Review what changed, then apply your edit again on the latest version.`,
      {
        status: 409,
        details: {
          entity: 'booking',
          id: input.bookingId,
          expectedVersion: input.expectedVersion,
          currentVersion: input.currentVersion,
          changes: input.changes,
          changedBy: input.changedBy,
        },
      },
    );
  }
}
