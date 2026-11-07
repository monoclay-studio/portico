/**
 * Processing purposes and their lawful basis (readiness brief §12: "Do not assume consent is the correct basis
 * for every hotel operation, or that withdrawing marketing consent requires erasing legally retained financial
 * records"). Pure. The bases below are product defaults recorded per purpose; they are NOT legal opinions —
 * a hotel (the controller) confirms them for its jurisdictions (see README open questions).
 */

export const CONSENT_PURPOSES = [
  'marketing_email',
  'marketing_sms',
  'marketing_whatsapp',
  'profiling',
  'cross_property_sharing',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentState = 'granted' | 'withdrawn' | 'unknown';

export type LegalBasis = 'consent' | 'contract' | 'legal_obligation' | 'legitimate_interests';

export interface PurposeBasis {
  purpose: ConsentPurpose;
  basis: LegalBasis;
  /** How the recorded consent state gates processing for this purpose. */
  gate: 'requires_granted' | 'blocked_if_withdrawn';
}

/**
 * Marketing and profiling require an explicit grant (unknown = no). Cross-property sharing inside one
 * organization defaults to legitimate interests (Q46) — processing continues unless the guest objected
 * (`withdrawn`); an organization policy can switch it to require explicit consent.
 */
export function purposeBasis(
  purpose: ConsentPurpose,
  opts: { sharingRequiresConsent?: boolean } = {},
): PurposeBasis {
  switch (purpose) {
    case 'marketing_email':
    case 'marketing_sms':
    case 'marketing_whatsapp':
    case 'profiling':
      return { purpose, basis: 'consent', gate: 'requires_granted' };
    case 'cross_property_sharing':
      return opts.sharingRequiresConsent
        ? { purpose, basis: 'consent', gate: 'requires_granted' }
        : { purpose, basis: 'legitimate_interests', gate: 'blocked_if_withdrawn' };
  }
}

export function mayProcess(basis: PurposeBasis, state: ConsentState): boolean {
  return basis.gate === 'requires_granted' ? state === 'granted' : state !== 'withdrawn';
}

/** Consent evidence must say what the guest saw and where — without it a "granted" state is not defensible. */
export function validateEvidence(
  state: ConsentState,
  evidence: { textVersion?: string | null; channel?: string | null },
): string | null {
  if (state === 'granted' && (!evidence.textVersion || !evidence.channel)) {
    return 'Recording a consent grant needs the version of the consent text the guest saw and the channel where it was given (evidence.textVersion and evidence.channel).';
  }
  return null;
}
