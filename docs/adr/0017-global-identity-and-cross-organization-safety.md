# ADR-0017: Global identity and cross-organization safety

**Status:** Accepted · **Date:** 2026-11-07

## Context

One person can work for several organizations, for example a consultant, a group finance manager, or a Monoclay
prospect who runs a trial next to their live hotel. That person has **one** global identity (`identity.users`): one
password, one set of MFA factors, and one set of recovery codes. Each organization grants them access separately,
through memberships and role assignments.

The steward review of the enterprise identity branch (`docs/orchestration/reviews/review-identity-plus.md`) proved
two account-takeover paths with executable tests. Both came from one design gap: **one organization could change a
credential that also protects the person's access to another organization.** The ways in were:

- an admin password reset;
- `createUser` with an initial password;
- an MFA reset;
- an SSO connection that lists someone else's email domain.

A trial organization costs nothing to create, so the paths were reachable by any prospect. Related findings were:

- an MFA grace period that let sensitive permissions work without MFA;
- API keys with no expiry that bypassed MFA;
- separation-of-duties checks that compared principals instead of people;
- break-glass self-designation;
- SSO accounts matched by a mutable email address.

## Decision

1. **Credentials belong to the person, not to an organization.** A person's password, MFA factors and recovery codes
   change only in one of two ways:
   - **(a)** the person does it themselves, while signed in, proving the factor they already have;
   - **(b)** a Monoclay security process does it: identity verification by an operator, dual control, and an audit
     record. This is the recovery path for a person who has lost every factor.

   An organization admin, SSO connection or SCIM client may start a password reset or MFA reset **only for a person
   whose every membership, in any status, is in that organization** ("sole-organization members"). For everyone
   else the admin's action becomes "ask the person to use self-service", or an escalation to Monoclay support.
2. **Joining an organization needs the person's consent.** Inviting, creating, SCIM-provisioning or JIT-provisioning
   an email that already belongs to a global user creates an `invited` membership. The person accepts it while signed
   in as themselves. Their password is never set and the membership is never activated silently. An initial
   password can be set only when a brand-new global user is created.
3. **Credential links go only to the person.** Invitation and reset links (`inv.`, `prt.`) are delivered only to the
   person's own email address. API responses never contain them. In non-live environments, simulated deliveries
   appear in an operator or developer mailbox, never in the response to the admin.
4. **Changing a credential needs proof of the existing credential.** Changing the password needs the current
   password. Enrolling, replacing or disabling an MFA factor, or regenerating recovery codes, needs the current
   factor or a recovery code. A fresh session is not enough. A session that comes from an organization's own IdP
   (SSO) never counts as step-up for a global credential.
5. **SSO identity is bound to `(issuer, sub)`.**
   - After the first link, sign-in matches on `(issuer, sub)` and refuses if the email maps to a different linked user.
   - `email_verified` must be true.
   - An organization may JIT-provision or link **existing** global users of an email domain only after proving it
     owns the domain (DNS TXT verification). Without that proof it may link only people who have no other
     membership, or the person must prove control of their existing account.
6. **Power is ordered.** An actor may revoke, suspend, remove or reset only members whose effective permissions are a
   subset of their own. No change may leave an organization without an active member holding organization-wide
   `identity.role.assign` + `identity.user.manage`. Monoclay keeps an operator recovery runbook for organizations
   that lose every administrator.
7. **Separation of duties compares people.** SoD checks resolve every principal to its responsible person:
   - an API client resolves to the user who created it;
   - a support session resolves to its operator.

   Approvals that SoD governs are human acts, so API clients cannot make them.
8. **MFA comes before sensitive permissions.** A grace period lets a new member enrol MFA, and nothing else.
   - During the grace, permissions marked sensitive (⚑) do not take effect.
   - The grace is anchored to the person's first activation anywhere, so rehiring, re-inviting or SCIM cycling
     cannot restart it.
   - Policy can set the grace to at most 72 hours.
   - Second-factor failures are counted per person, across challenges; repeated failures cause escalating delays,
     then a lock, and alert the person and the organization's admins.
9. **API keys are bounded.**
   - A key carrying ⚑ permissions needs a recent step-up when it is issued and a mandatory expiry of 90 days or less.
   - Keys are revoked when their creator is suspended, resets a password, or has MFA reset.
   - Identity administration permissions cannot go into a key, except `identity.scim.provision`.
   - Issuing a production key calls `assertExternalEffectAllowed(ctx, 'credentials.production')` (ADR-0010).
10. **Break-glass cannot be self-granted and leaves no durable privilege.**
    - Nobody can designate themselves.
    - The person who designates must hold every permission of the break-glass role.
    - While an elevation is active, durable privilege changes are refused: assigning roles, issuing API keys, editing
      roles, SSO mappings or security policy, and creating SCIM tokens.
11. **Client IPs come only from trusted proxies.** The API trusts `X-Forwarded-For` only from configured proxy
    addresses (`TRUSTED_PROXY_CIDRS`, the ALB's VPC range). Per-IP limits and sign-in risk rules key on the real
    client address. Implemented on main in `packages/http`.

## Consequences

- Admin screens tell the admin *why* an action is unavailable. For example: "This person also works for another
  organization, so only they can reset their password. Send them the self-service link." No other organization is
  named.
- Each takeover path in the review becomes a cross-organization regression test that fails before the fix and passes
  after it.
- Monoclay needs an identity-verification procedure for support-led credential recovery. Its owner and SLA are a
  launch-gate item in the readiness register.
- Domain verification adds a setup step for enterprise SSO. That is the industry norm and the price of linking
  existing accounts safely.
