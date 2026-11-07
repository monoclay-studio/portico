/**
 * Profile scoping (brief §7, spec GUE-R16, Q46 default). Profiles are organization-wide; what a staff member
 * sees depends on the properties where they hold permissions, where the guest is known, the organization's
 * sharing policy and entitlement, and the guest's cross-property-sharing consent. Pure.
 *
 *  - full   : the guest is known at a property where the user holds `guests.profile.read` (or the user holds it
 *             organization-wide). Property-private items are shown only for the user's properties.
 *  - shared : the guest is NOT known at the user's properties, but sharing is entitled + enabled for a property
 *             where the user holds `guests.profile.readShared`, and the guest has not objected (consent).
 *             Only shared fields: identity, contacts, shared preferences/alerts/notes, stay history.
 *  - none   : 404 — the profile does not exist as far as this user is concerned.
 */

export type Visibility = 'full' | 'shared' | 'none';

export interface AccessScope {
  /** Organization-wide guests.profile.read. */
  readAll: boolean;
  /** Properties where the user holds guests.profile.read (ignored when readAll). */
  readPropertyIds: readonly string[];
  /** Whether the user may see shared profiles (entitlement + policy + guests.profile.readShared). */
  sharedViewing: boolean;
  /** Sharing requires an explicit `granted` cross_property_sharing consent (policy). */
  sharingRequiresConsent: boolean;
}

export type SharingConsentState = 'granted' | 'withdrawn' | 'unknown';

export function profileVisibility(
  scope: AccessScope,
  linkedPropertyIds: readonly string[],
  sharingConsent: SharingConsentState,
): Visibility {
  if (scope.readAll) return 'full';
  if (linkedPropertyIds.some((p) => scope.readPropertyIds.includes(p))) return 'full';
  if (!scope.sharedViewing) return 'none';
  if (sharingConsent === 'withdrawn') return 'none';
  if (scope.sharingRequiresConsent && sharingConsent !== 'granted') return 'none';
  return 'shared';
}

/**
 * Aggregate the cross-property-sharing consent of a profile across legal entities: any withdrawal (objection)
 * wins; otherwise any grant; otherwise unknown.
 */
export function aggregateSharingConsent(states: readonly SharingConsentState[]): SharingConsentState {
  if (states.includes('withdrawn')) return 'withdrawn';
  if (states.includes('granted')) return 'granted';
  return 'unknown';
}

export type ItemVisibility = 'shared' | 'property_private' | 'department';

/** Sharing applies to this viewer and this guest (policy + entitlement + permission + no objection). */
export function sharingApplies(scope: AccessScope, sharingConsent: SharingConsentState): boolean {
  if (!scope.sharedViewing || sharingConsent === 'withdrawn') return false;
  return !(scope.sharingRequiresConsent && sharingConsent !== 'granted');
}

/**
 * Whether one property-scoped item (note, alert) is visible.
 *  - items of the viewer's own properties: shared and property-private ones; department notes need
 *    `guests.note.readPrivate` there (or authorship);
 *  - items of OTHER properties: only `shared` ones, and only when sharing applies — so switching sharing off
 *    hides other properties' data even on a profile known at several properties;
 *  - organization-level shared items (no property) follow the profile.
 */
export function itemVisible(
  scope: AccessScope,
  profileView: Visibility,
  item: { visibility: ItemVisibility; propertyId: string | null; authoredByActor?: boolean },
  sharingConsent: SharingConsentState,
  opts: { readPrivateNotePropertyIds?: readonly string[] | 'all' } = {},
): boolean {
  if (profileView === 'none') return false;
  const own =
    profileView === 'full' &&
    (scope.readAll || (item.propertyId !== null && scope.readPropertyIds.includes(item.propertyId)));
  if (!own) {
    if (item.visibility !== 'shared') return false;
    return item.propertyId === null || profileView === 'shared' || sharingApplies(scope, sharingConsent);
  }
  if (item.visibility === 'shared' || item.visibility === 'property_private') return true;
  if (item.authoredByActor) return true;
  const rp = opts.readPrivateNotePropertyIds ?? [];
  return rp === 'all' || (item.propertyId !== null && rp.includes(item.propertyId));
}

/** Identity documents and sensitive data are never shared across properties (Q46). */
export function documentVisible(scope: AccessScope, profileView: Visibility, propertyId: string): boolean {
  if (profileView !== 'full') return false;
  return scope.readAll || scope.readPropertyIds.includes(propertyId);
}

/** Stay history: own properties always; other properties only when sharing applies. */
export function stayVisible(
  scope: AccessScope,
  profileView: Visibility,
  propertyId: string,
  sharingConsent: SharingConsentState,
): boolean {
  if (profileView === 'none') return false;
  if (profileView === 'full' && (scope.readAll || scope.readPropertyIds.includes(propertyId))) return true;
  return sharingApplies(scope, sharingConsent);
}
