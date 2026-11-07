# identity — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Wave 0 on `main`; enterprise wave on `feat/identity-platform-enterprise`
(**do not merge** — REV-identity-plus-2) · Spec `docs/specs/identity.md` · Parity: **none** · Source key:
`docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **On `main` (R3, wave 0):** users and memberships, scoped roles, sessions bound to one organization, API clients,
  lockout, permission checks with property scope (STATUS § 3).
- **On the branch (README-identity there; 105 tests):** TOTP MFA with recovery codes and a per-person failure counter;
  central step-up for ⚑ permissions; credentials belong to the person (ADR-0017); OIDC SSO bound to `(issuer, sub)` with
  DNS-verified domains; SCIM users and groups; permission catalog; custom roles with preview; grant guardrails (no
  self-grant, no escalation, power ordering); invitations; password reset; transfer between properties; time-limited
  assignments; session management; bounded API keys; Monoclay support access (time-boxed, approved, read-only,
  impersonation marker); break-glass; suspicious-activity alerts.
- **Open review findings (REV-identity-plus-2):** **R2-P0-1** account pre-hijacking — any organization can mint a
  global identity with a password for an email it does not own and later take over that person's membership elsewhere,
  including the **first administrator of a newly provisioned live organization**; R2-P1-1 `identity.sso.manage` can
  impersonate the org admin by repointing the issuer; R2-P1-2 any organization can permanently block a new person from
  joining; R2-P1-3 pre-created SSO links bypass the verified-domain gate; six P2s (MFA attempt race, `transferMember`
  power bypass, group reconciliation removing the last admin, stale turbo cache hiding a typecheck failure).
- **Not built:** WebAuthn/passkeys, SAML, PIN quick-switch on shared terminals, generic approvals primitive, department
  scope and field-level restriction, operator recovery of a person who lost every factor, recovery of an org that lost
  every admin, staff-member record types and search provider (README-identity § Known gaps, branch).
- **UX1 persona 7 and cross-cutting:** invite defaults to "Whole organization" (riskiest), one role per invite,
  "Invite" sends nothing (you set a password yourself), raw role codes, "1 PERMISSIONS", forbidden page still shows
  Invite, HK supervisor can open arrivals by URL (simulated screens — verify server permission), no "remember this
  device", no "forgot password" link, 55-character email retyped every morning.

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Partner access governance | Oracle OHIP | Chain admin approves each partner connection; module-level scopes; separate Sensitive Data Access; customer-owned client apps | DD02a §1.4; DG #4 |
| Consent for apps | Apaleo | OAuth with consent screen; MCP with OAuth 2.0 | R02 §3.6; DD02b §2 |
| Enterprise expectations | RFPs | SSO/SAML, MFA, SCIM, audit, SOC 2 / ISO 27001 evidence | R04 §C4, §D4 |
| Shared desk terminals | (market practice, unverified) | PIN quick-switch on shared desk PCs | IDN-R04 (spec); assumption |

Reliability and security drive switching: 48% / 42% would switch PMS over them (DG #26 [3P], sponsored).

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Evidence |
|---|---|---|---|
| 1 | Email-verified identities (ADR-0017 amendment): remove `initialPassword`, `email_verified_at`, unverified identities org-local, wipe pre-verification credentials, provisioning confirms the first admin | P0 takeover of every first onboarding | R2-P0-1 |
| 2 | SSO configuration as a root change; credential-based (not membership-based) first-password rule; SSO checks on every membership creation | P1 impersonation and griefing | R2-P1-1…3 |
| 3 | Shared-terminal speed: PIN quick-switch, "remember this device" policy, passkeys | Desk staff sign in many times per shift (UX1 persona 1) | IDN-R02, R04; backoffice README Q3 |
| 4 | Humane admin UX contracts: invite defaults to current property, several role/property chips, plain role names and counts, real invitation emails | UX1 persona 7 friction | UX1 top-20 #20 |
| 5 | Agent and partner principals: consent scopes incl. sensitive data, human principal behind every agent action, re-approval on scope change | AI and partner apps (M12) | DG §2 identity row |
| 6 | Generic approvals primitive (thresholds for adjustments, refunds, write-offs, rate approvals) | Many modules wait for it | FIN-R10, PAY-R17, PAR-RAT-019 |
| 7 | Parity file and staff-member record type/search | Measurability; global search for staff | README § Known gaps |
| 8 | Operator recovery runbooks (lost every factor; lost every admin) | Launch-gate items | README § Known gaps |

## 4. The 10x outcome (TARGETS)

**Picture:** a desk agent switches users on a shared terminal with a PIN in two seconds, an owner invites a new
housekeeper to one property with the right role in under a minute, an enterprise IT team connects its IdP and SCIM
without a ticket — and no organization can ever touch a person's credentials or membership elsewhere.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | Open P0/P1 security findings | 1 P0, 3 P1 | — | 0 (third steward review clean) |
| Powerful | Cross-organization attack PoCs refused | 11 original refused; 9 new succeed | — | 100% refused, kept as regression tests |
| Seamless | Shared-terminal user switch | full sign-in | baseline to measure | ≤ 3 s with PIN after a once-per-shift full sign-in |
| Seamless | Invite a staff member to one property with one or more roles | ~90 s, 8 clicks, ~100 keystrokes (UX1) | baseline to measure | ≤ 45 s, defaults to the current property, invitation actually delivered |
| Friendly | Raw permission/role codes shown to staff | yes (UX1) | — | 0 |
| Well-rounded | Enterprise checklist: OIDC, SAML, SCIM, MFA, passkeys, audit export | OIDC/SCIM/MFA (branch) | RFP expectations (R04 §D4) | all, each R3 with an IdP sandbox test at R4 before an enterprise pilot |

## 5. Next 3 increments

### Increment 1 — Close the takeover class (ADR-0017 amendment)
- Implement the reviewer's fix list for R2-P0-1 (no `initialPassword`; `email_verified_at`; unverified identities
  org-local; wipe credentials set before first verification; provisioning returns the first admin's status and sends
  the invitation) and R2-P1-1…3 (SSO config as a root change with a second admin or org-wide `*`; issuer change resets
  domain verification; credential-based first-password rule; SSO membership checks on every create/activate; write user
  and link only after checks); P2s (atomic MFA attempt reservation, `transferMember` power/scope, reconciliation keeps
  the last admin). Force `pnpm typecheck --force` in CI (R2-P2-6).
- **Acceptance:** all PoCs in `docs/orchestration/reviews/identity-plus-poc/` refused as regression tests; third
  steward review with 0 P0/P1; branch merged with the 13 adapted cross-module tests.

### Increment 2 — Desk-speed sign-in and humane administration
- PIN quick-switch on enrolled shared devices (policy-gated, never for ⚑ permissions without step-up); "remember this
  device" policy; WebAuthn/passkeys; invite flow contracts (current-property default, multiple role/property pairs,
  delivered invitation via the notifier, plain role names, permission counts); staff-member record type and search
  provider; write `docs/parity/identity.md` with the parity workstream.
- **Acceptance:** PIN switch ≤ 3 s in an API timing test; invite with two roles in one call; UX1 persona 7 frictions
  #20 resolved in the next black-box round.

### Increment 3 — Approvals and agent principals
- Generic approvals primitive (request → approver ≠ requester → effect, thresholds as policy) used first by finance
  adjustments and payments refunds; agent/partner principals with consent scopes incl. sensitive data, `via` marker on
  every audited action, re-approval on scope change (with integration's partner apps).
- **Acceptance:** FIN-R10 threshold approvals and PAY-R17 refund approval tested through the primitive; an AI/partner
  action audit shows the human principal; scope escalation requires re-consent.

## 6. Cross-module dependencies and contract changes

- **platform:** human approvers (`assertHumanApprover`), activation; **integration:** partner apps and scopes; **ai:**
  agent principal; **finance/payments/rates:** approvals primitive; **backoffice:** PIN switch, invite UX, MFA flows
  (`mfa_required` handling — PF); **all modules:** role templates updated with each module's permissions at merge.
- **New contract:** `requestApproval/decideApproval`, `pinSwitch`, `consentScopes` on API clients, `actor.via`.

## 7. Power check — never lose or hide

Credentials belong to the person; no organization changes another organization's member's credentials; ⚑ permissions
need MFA and step-up; no self-grant or escalation; the last administrator can never be removed by any path; support
access is time-boxed, reasoned, approved and visible; deny by default on every endpoint.
