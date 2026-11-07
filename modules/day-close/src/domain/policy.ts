/**
 * Property Day Close policy: what blocks, what only warns, and how no-shows are handled. Policy decides per code,
 * except that integrity codes can never be demoted or overridden (DCL-I02) and an unreadable policy fails CLOSED:
 * the defaults apply AND a blocking `policy_invalid` item says what to fix (never "nothing blocks").
 */
import { type DayClosePolicy, type DayClosePolicyInput, dayClosePolicy } from '../contracts';

export const POLICY_KEY = 'dayClose.policy';

/** Ledger integrity alarms: always block, never demoted, never overridden. */
export const INTEGRITY_CODES = [
  'entry_unbalanced',
  'folio_ledger_mismatch',
  'negative_deposit',
  'integrity_failed',
  'policy_invalid',
] as const;

/** Codes that block unless the policy demotes them. */
export const DEFAULT_BLOCKING_CODES = [
  ...INTEGRITY_CODES,
  'settled_folio_with_balance',
  'departure_not_checked_out',
  'step_item_failed',
] as const;

export function defaultPolicy(): DayClosePolicy {
  return dayClosePolicy.parse({});
}

export interface ResolvedPolicy {
  policy: DayClosePolicy;
  valid: boolean;
  problems: string[];
  source: string;
}

/** Parse a stored policy value; invalid values fall back to defaults and are reported (fail closed). */
export function resolvePolicyValue(raw: unknown, source: string): ResolvedPolicy {
  if (raw === null || raw === undefined)
    return { policy: defaultPolicy(), valid: true, problems: [], source };
  const parsed = dayClosePolicy.safeParse(raw);
  if (!parsed.success) {
    return {
      policy: defaultPolicy(),
      valid: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'policy'}: ${i.message}`),
      source,
    };
  }
  const problems = policyProblems(parsed.data);
  if (problems.length) return { policy: defaultPolicy(), valid: false, problems, source };
  return { policy: parsed.data, valid: true, problems: [], source };
}

/** Problems that make a policy unusable even though it parses (saving such a policy is refused). */
export function policyProblems(p: DayClosePolicy): string[] {
  const out: string[] = [];
  const integrity = new Set<string>(INTEGRITY_CODES);
  for (const c of p.warningCodes) {
    if (integrity.has(c))
      out.push(`${c} is a ledger integrity check: it always blocks Day Close and cannot be made a warning.`);
  }
  for (const c of p.blockingCodes) {
    if (p.warningCodes.includes(c)) out.push(`${c} is listed both as blocking and as a warning.`);
  }
  return out;
}

/** Validate a policy before saving (DCL policy endpoint): refused if it would not work. */
export function validatePolicyInput(input: DayClosePolicyInput): {
  policy: DayClosePolicy;
  problems: string[];
} {
  const policy = dayClosePolicy.parse(input);
  return { policy, problems: policyProblems(policy) };
}

export function effectiveBlockingCodes(p: DayClosePolicy): string[] {
  const set = new Set<string>([...DEFAULT_BLOCKING_CODES, ...p.blockingCodes]);
  if (p.noShow.mode === 'decide') set.add('arrival_not_checked_in');
  for (const c of p.warningCodes) if (!(INTEGRITY_CODES as readonly string[]).includes(c)) set.delete(c);
  return [...set].sort();
}

export function isIntegrityCode(code: string): boolean {
  return (INTEGRITY_CODES as readonly string[]).includes(code);
}

/**
 * Does an item block Day Close? Policy decides by code; a valid override clears it unless it is an integrity code.
 * A source's own `blocking` severity is respected only for integrity codes and codes the policy does not demote.
 */
export function classify(
  item: { code: string; severity: 'blocking' | 'warning' | 'info' },
  policy: DayClosePolicy,
  overridden: boolean,
): { blocking: boolean; overridable: boolean } {
  if (isIntegrityCode(item.code)) return { blocking: true, overridable: false };
  const codes = new Set(effectiveBlockingCodes(policy));
  const demoted = policy.warningCodes.includes(item.code);
  const blocks = codes.has(item.code) || (item.severity === 'blocking' && !demoted);
  return { blocking: blocks && !overridden, overridable: blocks };
}
