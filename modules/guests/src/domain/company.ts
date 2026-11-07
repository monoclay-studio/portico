/**
 * Companies and travel agents (glossary: an agency is a company with kind=agency). Pure rules.
 */

export type CompanyKind = 'company' | 'agency';
export type CompanyStatus = 'active' | 'on_hold' | 'inactive';

/**
 * IATA agency numeric code: 7 digits + 1 check digit (the check digit is the 7-digit number modulo 7).
 * Many DMCs/tour operators have no IATA code; the field is optional. TIDS codes (non-IATA) also use 8 digits.
 */
export function validateIataCode(code: string): { ok: boolean; reason?: string } {
  if (!/^\d{8}$/.test(code))
    return { ok: false, reason: 'An IATA agency code has 8 digits (7 digits and a check digit).' };
  const base = Number(code.slice(0, 7));
  const check = Number(code.slice(7));
  if (base % 7 !== check)
    return {
      ok: false,
      reason: 'The IATA check digit does not match. Check the code on the agency’s documents.',
    };
  return { ok: true };
}

/**
 * Commission terms are a reference to what was agreed — the commission itself is computed by rates/finance on
 * the agreed booking terms. Percentages are integer basis points (1000 = 10.00%) — never floats.
 */
export interface CommissionTerms {
  model: 'percent_of_room' | 'percent_of_total' | 'net_rate' | 'none';
  basisPoints?: number;
  /** Reference to the contract or rate agreement (rates module), e.g. "2027 DMC contract". */
  reference?: string;
}

export function validateCommission(terms: CommissionTerms): string | null {
  if (terms.model === 'percent_of_room' || terms.model === 'percent_of_total') {
    if (terms.basisPoints === undefined || !Number.isInteger(terms.basisPoints))
      return 'Percentage commission needs basisPoints as a whole number (e.g. 1000 for 10%).';
    if (terms.basisPoints < 0 || terms.basisPoints > 5000)
      return 'Commission must be between 0% and 50% (0–5000 basis points).';
  } else if (terms.basisPoints !== undefined) {
    return 'Only percentage commission models take basisPoints.';
  }
  return null;
}

/** Parent links must never form a cycle (reporting hierarchy, GUE-R08). */
export function wouldCreateCycle(
  companyId: string,
  newParentId: string,
  parentOf: (id: string) => string | null | undefined,
  maxDepth = 50,
): boolean {
  let cursor: string | null | undefined = newParentId;
  for (let i = 0; cursor && i < maxDepth; i++) {
    if (cursor === companyId) return true;
    cursor = parentOf(cursor);
  }
  return cursor === companyId;
}

const TRANSITIONS: Record<CompanyStatus, readonly CompanyStatus[]> = {
  active: ['on_hold', 'inactive'],
  on_hold: ['active', 'inactive'],
  inactive: ['active'],
};

export function canTransitionCompany(from: CompanyStatus, to: CompanyStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
