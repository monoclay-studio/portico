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
  /** True when the legal entity belongs to this organization (consent is recorded per legal entity). */
  legalEntityExists(tx: TxContext, legalEntityId: string): Promise<boolean>;
  /** The property's business date (alert active periods are judged on the property's day). */
  getBusinessDate(tx: TxContext, propertyId: string): Promise<string>;
}

/** Booking confirmation code → profile ids of its booker/occupants (reservations index; GUE-R20). */
export interface BookingLookupPort {
  findProfileIdsByConfirmationCode(tx: TxContext, code: string): Promise<string[]>;
}

/**
 * Field-level crypto, bound in the composition root to the kernel `fieldCryptoFromEnv()` (KMS in production).
 * `cipher` encrypts documents and special needs; `blindIndex` is a keyed hash with a SEPARATE key, used for exact
 * matching (document numbers, duplicate exact keys) without storing the values. The module never handles keys.
 */
export interface GuestsCryptoPort {
  cipher: FieldCipher;
  blindIndex(input: string): string;
}

/** Key id embedded in a v1 ciphertext (`v1.<keyId>.…`) — stored next to it for rotation. */
export function keyIdOf(ciphertext: string): string {
  return ciphertext.split('.')[1] ?? 'unknown';
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
  bookingLookup?: BookingLookupPort;
}
