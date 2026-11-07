/**
 * Idempotent replay without personal data (SW-GUE-1). Every guests endpoint whose response contains personal data
 * stores only ids for replay and rebuilds the response from the current record, in the replaying caller's
 * transaction. A replay therefore honours erasure (410), later changes and the caller's current permissions —
 * the idempotency store never holds a guest's name, contacts, date of birth or free text.
 */
import { IdempotentResponseErasedError, type ReplayPlan, type TxContext } from '@portico/db';
import type { CompanyView, GuestProfile } from './contracts';
import type { GuestsService, PossibleDuplicate } from './service';
import type { MergeView } from './service/merge';
import type { PrivacyRequestView } from './service/privacy';

interface ProfileRef {
  profileId: string;
  propertyId?: string | null;
}

export function guestsReplayPlans(svc: GuestsService) {
  /** The current profile view; an erased (anonymized) guest's stored response is gone (410). */
  const currentProfile = async (tx: TxContext, ref: ProfileRef): Promise<GuestProfile> => {
    const p = await svc.getProfile(tx, ref.profileId, ref.propertyId ? { propertyId: ref.propertyId } : {});
    if (p.status.profile === 'anonymized') throw new IdempotentResponseErasedError();
    return p;
  };

  /** The create response is narrowed to the creating property (as the original response was). */
  const createProfile = (
    propertyId: string,
  ): ReplayPlan<
    { profile: GuestProfile; created: boolean; possibleDuplicates: PossibleDuplicate[] },
    ProfileRef & { created: boolean; possibleDuplicates: PossibleDuplicate[] }
  > => ({
    // possibleDuplicates holds ids, scores and reason codes only — no personal values.
    store: (b) => ({
      profileId: b.profile.id,
      propertyId,
      created: b.created,
      possibleDuplicates: b.possibleDuplicates,
    }),
    rebuild: async (tx, s) => {
      const profile = await currentProfile(tx, s);
      // Suggestions are re-checked against the caller's CURRENT visibility (R2-P3-3).
      const visible = await svc.visibleProfileIds(
        tx,
        s.possibleDuplicates.map((d) => d.profileId),
        { propertyId: s.propertyId ?? null },
      );
      return {
        profile,
        created: s.created,
        possibleDuplicates: s.possibleDuplicates.filter((d) => visible.has(d.profileId)),
      };
    },
  });

  const profile: ReplayPlan<GuestProfile, ProfileRef> = {
    store: (p) => ({ profileId: p.id }),
    rebuild: (tx, s) => currentProfile(tx, s),
  };

  const alertCreated: ReplayPlan<
    { alertId: string; profile: GuestProfile },
    ProfileRef & { alertId: string }
  > = {
    store: (b) => ({ alertId: b.alertId, profileId: b.profile.id }),
    rebuild: async (tx, s) => ({ alertId: s.alertId, profile: await currentProfile(tx, s) }),
  };

  const noteCreated: ReplayPlan<{ noteId: string; profile: GuestProfile }, ProfileRef & { noteId: string }> =
    {
      store: (b) => ({ noteId: b.noteId, profileId: b.profile.id }),
      rebuild: async (tx, s) => ({ noteId: s.noteId, profile: await currentProfile(tx, s) }),
    };

  /**
   * Responses that carry only ids of a guest's record (document, special need) still belong to that guest: the
   * stored ref names the profile, so erasure redacts it, and a replay checks the guest still exists.
   */
  const ofProfile = <T extends Record<string, string | null>>(
    profileId: string,
  ): ReplayPlan<T, { profileId: string; body: T }> => ({
    store: (b) => ({ profileId, body: b }),
    rebuild: async (tx, s) => {
      await currentProfile(tx, { profileId: s.profileId });
      return s.body;
    },
  });

  // Merge records hold reasons (free text) and field decisions; erasure redacts them, so re-read.
  const merge: ReplayPlan<MergeView, { mergeId: string }> = {
    store: (m) => ({ mergeId: m.id }),
    rebuild: (tx, s) => svc.getMerge(tx, s.mergeId),
  };

  // Company records may carry a person's billing email or notes.
  const company: ReplayPlan<CompanyView, { companyId: string }> = {
    store: (c) => ({ companyId: c.id }),
    rebuild: (tx, s) => svc.getCompany(tx, s.companyId),
  };

  const privacyRequest: ReplayPlan<PrivacyRequestView, { requestId: string }> = {
    store: (r) => ({ requestId: r.id }),
    rebuild: (tx, s) => svc.getPrivacyRequest(tx, s.requestId),
  };

  return { createProfile, profile, alertCreated, noteCreated, ofProfile, merge, company, privacyRequest };
}
