import type { TxContext } from '@portico/db';
import type { EffectMode, FieldCipher, PermissionDefinition } from '@portico/kernel';

/**
 * What identity needs from other modules and from infrastructure. Bound in apps/api/src/composition.ts; tests bind
 * fakes. Only `propertyIdsInScope` is required (wave 0); the enterprise ports are optional so existing callers keep
 * working — each feature explains clearly when its port is not bound.
 */
export interface IdentityPorts {
  /** Platform: all property ids under a brand/region (expands scoped role assignments). */
  propertyIdsInScope(tx: TxContext, scope: { type: 'brand' | 'region'; id: string }): Promise<string[]>;
  /**
   * Every permission registered by every module (ModuleManifest.permissions). Needed for MFA step-up
   * (sensitivity), custom role validation, the catalog endpoint and support-session scopes. When unbound, step-up
   * is not enforced (wave-0 behaviour) — the composition root always binds it.
   */
  permissionCatalog?: () => readonly PermissionDefinition[];
  /** Field encryption for TOTP secrets, PKCE verifiers and stored secrets (KMS envelope in production). */
  cipher?: FieldCipher;
  /** Where SSO client secrets live (default adapter: field-encrypted rows; production: AWS Secrets Manager). */
  secrets?: SecretStore;
  /** Staff messages (invitations, password resets, security alerts) honouring environment safety. */
  notifier?: Notifier;
  /** HTTP access to identity providers (OIDC discovery, JWKS, token endpoint). */
  oidcHttp?: OidcHttpClient;
  /** Country of an IP address for the new-country sign-in signal (placeholder binding knows none). */
  geo?: GeoIpResolver;
  /** Monoclay operators allowed to use the internal console (support sessions). */
  operators?: OperatorDirectory;
  /** Platform: whether the organization is entitled to a feature (identity.sso, identity.scim). */
  hasEntitlement?: (tx: TxContext, feature: string) => Promise<boolean>;
  /** Platform: the organization's display name (messages). */
  organizationName?: (tx: TxContext) => Promise<string>;
  /** Platform: throws NotFound unless the property exists in this organization. */
  assertPropertyExists?: (tx: TxContext, propertyId: string) => Promise<void>;
  config?: IdentityConfig;
}

export interface IdentityConfig {
  /** Where the identity provider sends the browser back (the back-office SPA's callback route). */
  ssoRedirectUri?: string;
  /** Base URL of the staff web app, for links in invitations and password resets. */
  appBaseUrl?: string;
  /** Issuer label shown in authenticator apps. */
  totpIssuer?: string;
}

/** Secret storage port. References are opaque strings safe to store in tables; values never are. */
export interface SecretStore {
  put(tx: TxContext, input: { name: string; value: string }): Promise<{ ref: string }>;
  get(tx: TxContext, ref: string): Promise<string>;
  delete(tx: TxContext, ref: string): Promise<void>;
}

export type StaffMessageKind = 'staff.invitation' | 'staff.passwordReset' | 'staff.securityAlert';

export interface StaffMessage {
  kind: StaffMessageKind;
  to: string;
  subject: string;
  body: string;
  /** Present for invitations and password resets. Never logged; only delivered. */
  link?: string;
}

export interface NotifierResult {
  /** `live` = handed to the delivery channel; `simulate` = recorded only (non-live environments); `sandbox`. */
  mode: Exclude<EffectMode, 'blocked'>;
  /** In non-live environments the message is returned to the caller so it can be shown as *simulated*. */
  simulated?: StaffMessage;
}

/** Adapters must call `assertExternalEffectAllowed(tx, 'message.staff')` before delivering anything. */
export interface Notifier {
  send(tx: TxContext, message: StaffMessage): Promise<NotifierResult>;
}

export interface OidcHttpClient {
  getJson(url: string): Promise<unknown>;
  postForm(
    url: string,
    form: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: unknown }>;
}

export interface GeoIpResolver {
  /** ISO 3166-1 alpha-2 country, or null when unknown. */
  countryOf(ip: string): string | null;
}

export interface Operator {
  id: string;
  name: string;
  email: string;
}

/** Monoclay operator principals (NOT tenant users). Today: tokens from configuration; later: IAM Identity Center. */
export interface OperatorDirectory {
  authenticate(token: string): Operator | null;
}
