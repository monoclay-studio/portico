import { z } from 'zod';

export const loginRequest = z.object({
  email: z.email(),
  password: z.string().min(1).max(500),
  organizationId: z.uuid().optional(),
});

export const organizationChoice = z.object({ id: z.uuid(), name: z.string(), environment: z.string() });

export const loginResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('signed_in'),
    token: z.string(),
    expiresAt: z.string(),
    userId: z.uuid(),
    organization: organizationChoice,
  }),
  z.object({ status: z.literal('select_organization'), organizations: z.array(organizationChoice) }),
  z.object({
    status: z.literal('mfa_required'),
    challengeToken: z.string(),
    expiresAt: z.string(),
    methods: z.array(z.enum(['totp', 'recovery_code'])),
    organization: organizationChoice,
  }),
]);

export const me = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  organizationId: z.uuid(),
  environment: z.string(),
  roles: z.array(
    z.object({ key: z.string(), name: z.string(), scopeType: z.string(), scopeId: z.uuid().nullable() }),
  ),
  /** MFA state for prompts ("set up two-step verification by …", "verify to continue"). */
  mfa: z
    .object({
      enrolled: z.boolean(),
      verifiedAt: z.string().nullable(),
      stepUpValidUntil: z.string().nullable(),
      enrolmentGraceEndsAt: z.string().nullable(),
      requiredForSensitive: z.boolean(),
    })
    .optional(),
  /** Present while break-glass emergency access is active on this session. */
  elevation: z.object({ elevationId: z.uuid() }).optional(),
});

export const createUserRequest = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(200),
  jobTitle: z.string().max(200).optional(),
  /** Removed (ADR-0017 rule 12): accepted only so that a sender gets a clear `password_not_allowed` refusal. */
  initialPassword: z.unknown().optional(),
  roles: z
    .array(
      z.object({
        roleKey: z.string(),
        scopeType: z.enum(['organization', 'brand', 'region', 'property']),
        scopeId: z.uuid().optional(),
      }),
    )
    .default([]),
});

export const createUserResponse = z.object({
  userId: z.uuid(),
  /** Always `invited` (ADR-0017 rule 12): the person accepts from the email and chooses their own password. */
  status: z.literal('invited'),
  invitationExpiresAt: z.string(),
  delivery: z.lazy(() => delivery),
});

export const userSummary = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.string(),
  roles: z.array(z.object({ key: z.string(), scopeType: z.string(), scopeId: z.uuid().nullable() })),
});

// ───────────────────────────── MFA ─────────────────────────────

const secondFactor = z
  .object({ code: z.string().min(6).max(10).optional(), recoveryCode: z.string().min(10).max(20).optional() })
  .refine(
    (v) => !!v.code !== !!v.recoveryCode,
    'Send either a code from the authenticator app or a recovery code.',
  );
export const mfaChallengeRequest = z
  .object({
    challengeToken: z.string().min(10).max(200),
    code: z.string().min(6).max(10).optional(),
    recoveryCode: z.string().min(10).max(20).optional(),
  })
  .refine(
    (v) => !!v.code !== !!v.recoveryCode,
    'Send either a code from the authenticator app or a recovery code.',
  );
export const stepUpRequest = secondFactor;
export const stepUpResponse = z.object({ verifiedAt: z.string(), method: z.enum(['totp', 'recovery_code']) });
export const totpEnrolResponse = z.object({ factorId: z.uuid(), secret: z.string(), otpauthUri: z.string() });
/**
 * Proof of the person's existing credential before a global credential changes (ADR-0017 §4): the current
 * authenticator code (or a recovery code) when one is enrolled, otherwise the current password.
 */
export const credentialProof = z
  .object({
    currentPassword: z.string().min(1).max(500).optional(),
    code: z.string().min(6).max(10).optional(),
    recoveryCode: z.string().min(10).max(20).optional(),
  })
  .default({});
export const totpConfirmRequest = z.object({ code: z.string().min(6).max(10) });
export const recoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()) });
export const mfaStatusResponse = z.object({
  enrolled: z.boolean(),
  enrolledAt: z.string().nullable(),
  pendingEnrolment: z.boolean(),
  recoveryCodesRemaining: z.number().int(),
});

// ───────────────────────────── Security policy, sessions, alerts ─────────────────────────────

export const securityPolicy = z.object({
  mfaStepUpWindowMinutes: z.number().int().min(1).max(720),
  mfaGracePeriodHours: z.number().int().min(0).max(72),
  requireMfaForAll: z.boolean(),
  supportAccessApproval: z.enum(['always_required', 'auto_approve_read_only']),
  supportMaxMinutes: z.number().int().min(15).max(1440),
  breakGlassUserIds: z.array(z.uuid()).max(5),
  breakGlassRoleKey: z.string(),
  breakGlassMaxMinutes: z.number().int().min(15).max(240),
  version: z.number().int(),
});
export const securityPolicyUpdate = securityPolicy.omit({ version: true }).partial();
export const sessionSummary = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  authMethod: z.enum(['password', 'sso']),
  mfaVerifiedAt: z.string().nullable(),
  current: z.boolean(),
});
export const reasonRequest = z.object({ reason: z.string().min(3).max(1000) });
export const securityAlert = z.object({
  id: z.uuid(),
  rule: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  subjectUserId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  acknowledgedBy: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
});

// ───────────────────────────── Permission catalog and roles ─────────────────────────────

export const permissionCatalog = z.object({
  modules: z.array(
    z.object({
      module: z.string(),
      wildcard: z.string(),
      containsSensitive: z.boolean(),
      permissions: z.array(
        z.object({
          key: z.string(),
          description: z.string(),
          scope: z.enum(['organization', 'property']),
          sensitive: z.boolean(),
        }),
      ),
    }),
  ),
  totals: z.object({ permissions: z.number().int(), sensitive: z.number().int() }),
});
export const roleView = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  templateKey: z.string().nullable(),
  archived: z.boolean(),
  version: z.number().int(),
  sensitivePermissions: z.array(z.string()),
  effectivePermissionCount: z.number().int(),
  activeAssignments: z.number().int(),
});
export const createRoleRequest = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/, 'Use 3–50 lowercase letters, digits and underscores'),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  permissions: z.array(z.string().max(120)).min(1).max(500),
});
export const cloneRoleRequest = createRoleRequest.omit({ permissions: true });
export const updateRoleRequest = createRoleRequest.omit({ key: true }).partial();
export const rolePreviewRequest = z.object({ permissions: z.array(z.string().max(120)).max(500) });
export const rolePreviewResponse = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  addedSensitive: z.array(z.string()),
  affectedMembers: z.number().int(),
});

// ───────────────────────────── Staff lifecycle ─────────────────────────────

const scopeType = z.enum(['organization', 'brand', 'region', 'property']);
export const roleGrant = z.object({
  roleKey: z.string(),
  scopeType,
  scopeId: z.uuid().optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  reason: z.string().max(1000).optional(),
});
export const inviteRequest = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(200),
  jobTitle: z.string().max(200).optional(),
  roles: z.array(roleGrant.omit({ reason: true })).default([]),
});
/**
 * How a staff message (invitation, reset) was handled. Never contains the message or its link (ADR-0017 §3):
 * `queued` = handed to delivery, not yet confirmed sent; `simulated` = non-live, kept in the operator/developer
 * mailbox; `sandbox` = provider test mode.
 */
export const delivery = z.object({ mode: z.enum(['queued', 'simulated', 'sandbox']) });
export const inviteResponse = z.object({ userId: z.uuid(), invitationExpiresAt: z.string(), delivery });
export const acceptInvitationRequest = z.object({
  token: z.string().min(10).max(200),
  /** A brand-new person chooses a password; a person who already has one enters it (ADR-0017 §2/§4). */
  password: z.string().min(1).max(500).optional(),
  code: z.string().min(6).max(10).optional(),
  recoveryCode: z.string().min(10).max(20).optional(),
});
export const myInvitation = z.object({ organizationId: z.uuid(), name: z.string(), environment: z.string() });
export const devMailboxMessage = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  kind: z.string(),
  subject: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  createdAt: z.string(),
});
export const passwordResetRequest = z.object({ email: z.email() });
export const passwordResetComplete = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(12).max(500),
});
export const transferRequest = z.object({
  fromPropertyId: z.uuid(),
  toPropertyId: z.uuid(),
  roleKeys: z.array(z.string()).optional(),
  effectiveAt: z.iso.datetime().optional(),
  reason: z.string().min(3).max(1000),
});
export const transferPlan = z.object({
  userId: z.uuid(),
  fromPropertyId: z.uuid(),
  toPropertyId: z.uuid(),
  effectiveAt: z.string(),
  remove: z.array(z.object({ assignmentId: z.uuid(), roleKey: z.string() })),
  add: z.array(z.object({ roleKey: z.string(), propertyId: z.uuid() })),
});
export const memberDetail = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  jobTitle: z.string().nullable(),
  status: z.enum(['invited', 'active', 'suspended', 'removed']),
  defaultPropertyId: z.uuid().nullable(),
  provisionedBy: z.string(),
  externalId: z.string().nullable(),
  activatedAt: z.string().nullable(),
  lastSignInAt: z.string().nullable(),
  /** Null while the person has not accepted (their credentials are theirs, not this organization's — R2-P3-6). */
  mfa: mfaStatusResponse.nullable(),
  assignments: z.array(
    z.object({
      assignmentId: z.uuid(),
      roleKey: z.string(),
      roleName: z.string(),
      scopeType,
      scopeId: z.uuid().nullable(),
      startsAt: z.string().nullable(),
      endsAt: z.string().nullable(),
      source: z.string(),
      effective: z.boolean(),
    }),
  ),
  version: z.number().int(),
});
export const memberUpdate = z.object({
  displayName: z.string().min(1).max(200).optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  defaultPropertyId: z.uuid().nullable().optional(),
});

// ───────────────────────────── Support access and break-glass ─────────────────────────────

export const supportSession = z.object({
  id: z.uuid(),
  operatorId: z.uuid(),
  operatorName: z.string(),
  reason: z.string(),
  ticketRef: z.string(),
  scope: z.enum(['read_only', 'read_write']),
  propertyIds: z.array(z.uuid()).nullable(),
  durationMinutes: z.number().int(),
  status: z.enum(['pending_approval', 'active', 'declined', 'ended', 'revoked', 'expired']),
  requestedAt: z.string(),
  approvedBy: z.string().nullable(),
  approvalMode: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export const supportSessionRequest = z.object({
  organizationId: z.uuid(),
  reason: z.string().min(10).max(1000),
  ticketRef: z.string().min(1).max(100),
  scope: z.enum(['read_only', 'read_write']).default('read_only'),
  durationMinutes: z.number().int().min(15).max(1440).default(120),
  propertyIds: z.array(z.uuid()).max(100).optional(),
});
export const supportAccessLogEntry = z.object({
  occurredAt: z.string(),
  method: z.string(),
  path: z.string(),
});
export const elevationRequest = z.object({
  reason: z.string().min(20).max(2000),
  durationMinutes: z.number().int().min(1).max(240),
});
export const elevationView = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  reason: z.string(),
  startedAt: z.string(),
  endsAt: z.string(),
  endedAt: z.string().nullable(),
  active: z.boolean(),
  reviewStatus: z.enum(['pending', 'reviewed']),
  reviewedBy: z.string().nullable(),
  reviewNotes: z.string().nullable(),
});

// ───────────────────────────── SSO ─────────────────────────────

export const ssoConfigRequest = z.object({
  displayName: z.string().min(1).max(200),
  issuer: z.url(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(2000).optional(),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']).optional(),
  scopes: z.array(z.string().max(100)).max(20).optional(),
  allowedEmailDomains: z.array(z.string().max(253)).min(1).max(20),
  groupsClaim: z.string().max(100).optional(),
  jitProvisioning: z.boolean().optional(),
  trustIdpMfa: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export const ssoConnection = z.object({
  id: z.uuid(),
  displayName: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  clientSecretSet: z.boolean(),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
  scopes: z.array(z.string()),
  allowedEmailDomains: z.array(z.string()),
  groupsClaim: z.string(),
  jitProvisioning: z.boolean(),
  trustIdpMfa: z.boolean(),
  ssoRequired: z.boolean(),
  ssoExemptUserIds: z.array(z.uuid()),
  status: z.enum(['active', 'disabled']),
  mappings: z.array(
    z.object({
      id: z.uuid(),
      group: z.string(),
      roleKey: z.string(),
      scopeType: z.string(),
      scopeId: z.uuid().nullable(),
    }),
  ),
  version: z.number().int(),
});
export const ssoMappingsRequest = z.object({
  mappings: z
    .array(
      z.object({
        group: z.string().min(1).max(256),
        roleKey: z.string(),
        scopeType,
        scopeId: z.uuid().optional(),
      }),
    )
    .max(200),
});
export const ssoEnforcementRequest = z.object({
  ssoRequired: z.boolean(),
  exemptUserIds: z.array(z.uuid()).max(3).default([]),
});
export const ssoStartRequest = z.object({ organizationId: z.uuid() });
export const ssoStartResponse = z.object({
  authorizationUrl: z.string(),
  expiresAt: z.string(),
  /** Keep in the starting tab (sessionStorage) and send back with the callback; binds the login to this browser. */
  browserBinding: z.string(),
});
export const ssoCallbackRequest = z.object({
  state: z.string().min(10).max(300),
  code: z.string().min(1).max(4000),
  browserBinding: z.string().min(10).max(200),
});
export const ssoDomainRequest = z.object({ domain: z.string().min(3).max(253) });
export const ssoDomain = z.object({
  domain: z.string(),
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
  txtRecord: z.object({ name: z.string(), value: z.string() }),
});

// ───────────────────────────── SCIM (RFC 7643/7644) ─────────────────────────────

export const scimUserRequest = z
  .object({
    schemas: z.array(z.string()).optional(),
    userName: z.string().min(3).max(320),
    externalId: z.string().max(200).optional(),
    displayName: z.string().max(200).optional(),
    name: z
      .object({
        formatted: z.string().max(200).optional(),
        givenName: z.string().max(100).optional(),
        familyName: z.string().max(100).optional(),
      })
      .partial()
      .optional(),
    active: z.boolean().optional(),
  })
  .passthrough();
export const scimPatchRequest = z
  .object({
    schemas: z.array(z.string()).optional(),
    Operations: z
      .array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown().optional() }))
      .min(1)
      .max(100),
  })
  .passthrough();
export const scimGroupRequest = z
  .object({
    schemas: z.array(z.string()).optional(),
    displayName: z.string().min(1).max(256),
    externalId: z.string().max(200).optional(),
    members: z
      .array(z.object({ value: z.string() }).passthrough())
      .max(1000)
      .optional(),
  })
  .passthrough();
export const scimListQuery = z.object({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().min(1).optional(),
  count: z.coerce.number().int().min(0).max(200).optional(),
});

// ───────────────────────────── API clients ─────────────────────────────

export const apiClientRequest = z.object({
  name: z.string().min(1).max(200),
  permissions: z.array(z.string().max(120)).min(1).max(200),
  propertyIds: z.array(z.uuid()).max(500).optional(),
  expiresAt: z.iso.datetime().optional(),
});
export const apiClientCreated = z.object({
  clientId: z.uuid(),
  /** Shown once. Store it in the integration's secret store. */
  token: z.string(),
});
export const apiClientSummary = z.object({
  clientId: z.uuid(),
  name: z.string(),
  permissions: z.array(z.string()),
  propertyIds: z.array(z.uuid()).nullable(),
  status: z.enum(['active', 'revoked']),
  createdBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
