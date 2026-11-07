/**
 * Identity documents (spec GUE-R05, invariant GUE-I04). Pure helpers: normalization for the keyed hash,
 * masking, retention. Encryption itself is a port (FieldCipher) — this file never sees keys.
 */
import { addDays, type LocalDate } from '@portico/kernel';

export type DocumentType = 'passport' | 'national_id' | 'residence_permit' | 'driving_licence' | 'other';

/** Upper-case, strip spaces, dashes and the MRZ filler '<'. "AB 12-345<67" → "AB1234567". */
export function normalizeDocumentNumber(input: string): string {
  return input.toUpperCase().replace(/[\s\-<./]+/g, '');
}

/** Input to the keyed (HMAC) blind index used for exact duplicate detection and permitted exact search. */
export function documentHashInput(number: string, issuingCountry: string): string {
  return `doc:${issuingCountry.toUpperCase()}:${normalizeDocumentNumber(number)}`;
}

/** Keyed hash input for the last four characters (document last-4 search, permission-gated). */
export function documentLast4Input(number: string): string {
  return `doc4:${normalizeDocumentNumber(number).slice(-4)}`;
}

/** Masked form for permitted viewers: keeps only the last 3 characters. */
export function maskDocumentNumber(number: string): string {
  const n = normalizeDocumentNumber(number);
  return `${'•'.repeat(Math.max(3, n.length - 3))}${n.slice(-3)}`;
}

/**
 * Retention (Q44 default): identity-document fields are erased a configured number of days after the guest's
 * last departure (or after capture when no stay is known). Returns the later of the current and new dates.
 */
export function retentionDate(
  anchor: LocalDate,
  retentionDays: number,
  current?: LocalDate | null,
): LocalDate {
  const next = addDays(anchor, retentionDays);
  return current && current > next ? current : next;
}

export function isExpired(expiryDate: LocalDate | null, on: LocalDate): boolean {
  return expiryDate !== null && expiryDate < on;
}
