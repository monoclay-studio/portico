/**
 * Card-data guards. Portico must never receive or store a primary account number (PAN) or card verification
 * code: payment methods are provider tokens only (readiness brief §8, CLAUDE.md §5). These checks reject
 * anything that looks like card data at the boundary, before it can reach storage, logs or events.
 */

/** Luhn checksum (used by card numbers). */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * True when the string contains a run of 12–19 digits (optionally separated by single spaces/dashes) that
 * passes the Luhn check — the shape of a card number.
 */
export function containsPossiblePan(value: string): boolean {
  const candidates = value.match(/\d(?:[ -]?\d){11,18}/g) ?? [];
  for (const c of candidates) {
    const digits = c.replace(/[ -]/g, '');
    if (digits.length >= 12 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

/** Any run of 12+ consecutive digits (stricter check for fields that must never contain long numbers). */
export function containsLongDigitRun(value: string): boolean {
  return /\d(?:[ -]?\d){11,}/.test(value);
}

const FORBIDDEN_KEYS = /^(pan|card_?number|cardnumber|number|cvc|cvv|cvc2|cvv2|security_?code|track_?\d?|pin)$/i;

/** Recursively remove card-data-shaped fields from provider payloads before they are stored for audit. */
export function scrubCardData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubCardData);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(k)) {
        out[k] = '[removed]';
        continue;
      }
      out[k] = scrubCardData(v);
    }
    return out;
  }
  if (typeof value === 'string' && containsPossiblePan(value)) return '[removed: card-number-like value]';
  return value;
}
