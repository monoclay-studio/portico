/**
 * Contact point normalization (emails, phones) for exact-match keys, search and duplicate detection. Pure.
 */

export type ContactKind = 'email' | 'phone' | 'whatsapp' | 'address';

/**
 * OTA / channel proxy (alias) email domains. These addresses forward to the guest but are generated per booking,
 * so they are stored as low-confidence contact points and NEVER used as exact match keys (spec GUE-R09).
 * Data, not policy: extend as channels are connected.
 */
export const PROXY_EMAIL_DOMAINS: readonly string[] = [
  'guest.booking.com',
  'm.expediapartnercentral.com',
  'expediapartnercentral.com',
  'guest.airbnb.com',
  'reply.airbnb.com',
  'agoda-messaging.com',
  'messaging.agoda.com',
  'trip.com.guest',
  'guest.trip.com',
];

export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  // Deliberately conservative: one @, a dot in the domain, no spaces. Provider-specific rewriting (gmail dots,
  // plus-tags) is NOT applied — two different mailboxes must never become one match key.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

export function isProxyEmail(normalized: string): boolean {
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return PROXY_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Country calling codes and national trunk prefixes for the countries Portico meets first (Maldives source
 * markets + region). A national number for a country not listed cannot be normalized without the "+": the
 * caller stores it as entered and marks it unnormalized rather than guessing.
 */
const CALLING: Record<string, { code: string; trunk?: string; keepTrunk?: boolean }> = {
  MV: { code: '960' },
  CN: { code: '86', trunk: '0' },
  RU: { code: '7', trunk: '8' },
  KZ: { code: '7', trunk: '8' },
  IN: { code: '91', trunk: '0' },
  GB: { code: '44', trunk: '0' },
  DE: { code: '49', trunk: '0' },
  IT: { code: '39', keepTrunk: true },
  FR: { code: '33', trunk: '0' },
  ES: { code: '34' },
  CH: { code: '41', trunk: '0' },
  AT: { code: '43', trunk: '0' },
  NL: { code: '31', trunk: '0' },
  US: { code: '1', trunk: '1' },
  CA: { code: '1', trunk: '1' },
  AE: { code: '971', trunk: '0' },
  SA: { code: '966', trunk: '0' },
  QA: { code: '974' },
  KW: { code: '965' },
  BH: { code: '973' },
  OM: { code: '968' },
  LK: { code: '94', trunk: '0' },
  JP: { code: '81', trunk: '0' },
  KR: { code: '82', trunk: '0' },
  AU: { code: '61', trunk: '0' },
  SG: { code: '65' },
  MY: { code: '60', trunk: '0' },
  PL: { code: '48' },
  CZ: { code: '420' },
  UA: { code: '380', trunk: '0' },
};

export interface NormalizedPhone {
  /** E.164, e.g. +9607771234 — or null when the number cannot be normalized safely. */
  e164: string | null;
  digits: string;
}

/**
 * Normalize a phone number to E.164. Accepts "+44 20 7946 0958", "0044 20…", "(020) 7946 0958" with a default
 * country, "8 (916) 123-45-67" (Russia trunk 8) etc. Returns e164 = null when ambiguous.
 */
export function normalizePhone(input: string, defaultCountry?: string | null): NormalizedPhone {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length < 4) return { e164: null, digits };
  let international: string | null = null;
  if (trimmed.startsWith('+')) international = digits;
  else if (digits.startsWith('00')) international = digits.slice(2);
  else if (defaultCountry) {
    const c = CALLING[defaultCountry.toUpperCase()];
    if (c) {
      let national = digits;
      if (!c.keepTrunk && c.trunk && national.startsWith(c.trunk)) national = national.slice(c.trunk.length);
      // Already includes the country code without '+' (e.g. "9607771234" typed in the Maldives).
      if (national.startsWith(c.code) && national.length - c.code.length >= 7 && c.code.length >= 3) {
        international = national;
      } else {
        international = `${c.code}${national}`;
      }
    }
  }
  if (!international) return { e164: null, digits };
  // E.164: at most 15 digits, first digit not 0. Minimum 8 digits covers the shortest real plans (e.g. +9607xxxxxx).
  if (international.length < 8 || international.length > 15 || international.startsWith('0')) {
    return { e164: null, digits };
  }
  return { e164: `+${international}`, digits };
}

export function normalizeAddress(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface NormalizedContact {
  normalized: string | null;
  /** Never an exact-match key (proxy email, unparseable phone). */
  lowConfidence: boolean;
}

export function normalizeContact(
  kind: ContactKind,
  value: string,
  defaultCountry?: string | null,
): NormalizedContact {
  switch (kind) {
    case 'email': {
      const n = normalizeEmail(value);
      return { normalized: n, lowConfidence: n === null || isProxyEmail(n) };
    }
    case 'phone':
    case 'whatsapp': {
      const n = normalizePhone(value, defaultCountry);
      return { normalized: n.e164, lowConfidence: n.e164 === null };
    }
    case 'address':
      return { normalized: normalizeAddress(value), lowConfidence: true };
  }
}

/** Mask a contact for low-privilege display: "a•••@example.com", "+960 ••• 1234". */
export function maskContact(kind: ContactKind, value: string): string {
  if (kind === 'email') {
    const at = value.indexOf('@');
    if (at <= 0) return '•••';
    return `${value.charAt(0)}•••${value.slice(at)}`;
  }
  if (kind === 'address') return '•••';
  const digits = value.replace(/\D+/g, '');
  return `•••${digits.slice(-4)}`;
}
