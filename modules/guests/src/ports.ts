/**
 * What the guests module needs from other modules. Bound in apps/api/src/composition.ts; tests bind fakes or
 * the real platform service.
 */
import type { TxContext } from '@portico/db';
import type { EntityRef, FieldCipher } from '@portico/kernel';

export interface GuestsPlatformPort {
  /** platform.assertWritable for the `guestProfiles` data domain (ADR-0014). */
  assertWritable(tx: TxContext, propertyId: string, domain: 'guestProfiles'): Promise<'portico' | 'forward'>;
  /** platform.hasEntitlement — `portfolio.crossPropertyProfiles` gates cross-property sharing. */
  hasEntitlement(tx: TxContext, feature: string): Promise<boolean>;
  /** platform.resolvePolicy (property → region → brand → organization → default). No permission check. */
  resolvePolicy<T>(tx: TxContext, propertyId: string, key: string, defaultValue: T): Promise<{ value: T }>;
  /** Every property id of the organization (no permission filter — used to evaluate policies). */
  listPropertyIds(tx: TxContext): Promise<string[]>;
  /** ISO country of a property (default calling code for national-format phone numbers). */
  getPropertyCountry(tx: TxContext, propertyId: string): Promise<string | null>;
  /** Legal entity operating a property (consent is recorded per legal entity). */
  getPropertyLegalEntityId(tx: TxContext, propertyId: string): Promise<string>;
}

/**
 * Field-level crypto. `cipher` is the kernel FieldCipher (local key in development, KMS envelope encryption in
 * production). `blindIndex` is a keyed hash (HMAC) with a SEPARATE key, used for exact matching of document
 * numbers without storing them.
 */
export interface GuestsCryptoPort {
  cipher: FieldCipher;
  keyId: string;
  blindIndex(input: string): string;
}

/** Another module that holds profile references reports how many it holds (merge preview counts per module). */
export interface ProfileReferenceCounter {
  module: string;
  countReferences(tx: TxContext, profileId: string): Promise<number>;
}

/** Another module contributes its personal data about a profile to a data-subject export (GUE-R17). */
export interface PersonalDataContributor {
  module: string;
  collect(tx: TxContext, profileId: string): Promise<unknown>;
}

/** Communication history (comms module, wave 2). Unbound → the profile shows "not connected". */
export interface CommunicationHistoryPort {
  listForProfile(
    tx: TxContext,
    profileId: string,
  ): Promise<Array<{ ref: EntityRef; channel: string; occurredAt: string; summary: string }>>;
}

export interface GuestsPorts {
  platform: GuestsPlatformPort;
  crypto: GuestsCryptoPort;
  referenceCounters?: readonly ProfileReferenceCounter[];
  personalDataContributors?: readonly PersonalDataContributor[];
  communications?: CommunicationHistoryPort;
}
