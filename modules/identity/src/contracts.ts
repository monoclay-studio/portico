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
});

export const createUserRequest = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(200),
  jobTitle: z.string().max(200).optional(),
  initialPassword: z.string().min(12).max(500).optional(),
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

export const userSummary = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.string(),
  roles: z.array(z.object({ key: z.string(), scopeType: z.string(), scopeId: z.uuid().nullable() })),
});
