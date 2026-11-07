# ADR-0012: Identity: Portico sessions now; enterprise SSO and MFA next

**Status:** Accepted · **Date:** 2026-11-07

## Context

Staff need fast sign-in; enterprises need SSO/SCIM; privileged access needs MFA (readiness brief §13).

## Decision

Portico issues opaque, hashed session tokens bound to one organization (tenant id embedded and verified), with idle/absolute expiry, lockout and immediate revocation on offboarding. Wave 1 adds TOTP/WebAuthn MFA (required for sensitive permissions), OIDC/SAML SSO per organization, SCIM provisioning, emergency (break-glass) access and Monoclay support access with recorded reasons and customer visibility.

## Consequences

Works today without an external IdP; enterprise features layer on without changing the authorization model.
