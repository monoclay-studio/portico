/**
 * Suspicious-activity detection rules (readiness brief §13 "abuse prevention and suspicious activity detection").
 * Deliberately simple, explainable thresholds; each alert names the rule and the evidence. They are signals for a
 * human, never automatic punishment (except the existing per-account lockout).
 *
 *  R1 `credential_stuffing_suspected` — from one IP, ≥ 10 failed sign-ins across ≥ 3 distinct accounts within
 *     15 minutes. (Per-account lockout already stops guessing one account; this catches spraying many.)
 *  R2 `new_country_sign_in` — a successful sign-in from a country never seen for this member in this
 *     organization, when the member has prior sign-ins with a known country. Country comes from the GeoIP port;
 *     the default binding knows no countries (placeholder) so the rule is inert until a GeoIP source is bound.
 *  R3 `mass_export` — one actor performs ≥ 5 exports, or exports ≥ 10 000 records in total, within 60 minutes.
 */
export const SECURITY_RULES = {
  credentialStuffing: { windowMinutes: 15, minFailures: 10, minDistinctAccounts: 3 },
  massExport: { windowMinutes: 60, maxExports: 5, maxRecords: 10_000 },
} as const;

export type SecurityAlertRule =
  | 'credential_stuffing_suspected'
  | 'new_country_sign_in'
  | 'mass_export'
  | 'break_glass_activated'
  | 'break_glass_designation_changed'
  | 'mfa_bruteforce_suspected'
  | 'support_session_started'
  | 'sso_root_change'
  | 'last_administrator_kept';

export type AlertSeverity = 'low' | 'medium' | 'high';

export function isCredentialStuffing(stats: { failures: number; distinctAccounts: number }): boolean {
  const r = SECURITY_RULES.credentialStuffing;
  return stats.failures >= r.minFailures && stats.distinctAccounts >= r.minDistinctAccounts;
}

export function isNewCountry(country: string | null, knownCountries: readonly string[]): boolean {
  if (!country) return false;
  if (knownCountries.length === 0) return false; // first ever sign-in establishes the baseline
  return !knownCountries.includes(country);
}

export function isMassExport(stats: { exports: number; records: number }): boolean {
  const r = SECURITY_RULES.massExport;
  return stats.exports >= r.maxExports || stats.records >= r.maxRecords;
}

/** Alerts are de-duplicated per rule, subject and time bucket so a burst produces one alert, not hundreds. */
export function alertDedupeKey(
  rule: SecurityAlertRule,
  subject: string,
  at: Date,
  bucketMinutes: number,
): string {
  const bucket = Math.floor(at.getTime() / (bucketMinutes * 60_000));
  return `${rule}:${subject}:${bucket}`;
}
