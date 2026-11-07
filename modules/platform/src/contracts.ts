// Public API contracts for the platform module. No server-only imports here: web apps import this file.
import { z } from 'zod';

export const propertyProfile = z.enum([
  'guesthouse',
  'boutique_hotel',
  'hotel',
  'resort',
  'serviced_apartments',
  'hostel',
]);
export const tenantEnvironment = z.enum(['live', 'trial', 'sandbox', 'training', 'demo']);

const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter ISO country code, e.g. MV');
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. USD');

export const organization = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  environment: tenantEnvironment,
  status: z.enum(['active', 'suspended', 'closed']),
  planCode: z.string(),
  defaultLocale: z.string(),
});
export type Organization = z.infer<typeof organization>;

export const legalEntityInput = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().min(1).max(300),
  registrationNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),
  countryCode,
  baseCurrency: currencyCode,
  address: z.record(z.string(), z.string()).optional(),
});
export const legalEntity = legalEntityInput.extend({ id: z.uuid(), version: z.number().int() });
export type LegalEntity = z.infer<typeof legalEntity>;

/**
 * Jurisdiction classification consumed by tax & fee rules. Free-form per country; Maldives uses e.g.
 * { "mv.establishmentType": "resort" | "guesthouse" | "hotel" | "vessel", "mv.inhabitedIsland": true, "mv.roomCount": 12 }.
 */
export const classification = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const propertyInput = z.object({
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and dashes'),
  name: z.string().min(1).max(200),
  profile: propertyProfile,
  legalEntityId: z.uuid(),
  brandId: z.uuid().optional(),
  regionId: z.uuid().optional(),
  countryCode,
  timezone: z.string().min(1),
  baseCurrency: currencyCode,
  classification: classification.optional(),
  businessDate: z.iso.date(),
  checkInTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  checkOutTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export const propertyUpdate = propertyInput
  .omit({ code: true, businessDate: true, legalEntityId: true })
  .partial()
  .extend({
    status: z.enum(['setup', 'pilot', 'active', 'inactive']).optional(),
  });
export const property = propertyInput.extend({
  id: z.uuid(),
  status: z.enum(['setup', 'pilot', 'active', 'inactive']),
  classification,
  checkInTime: z.string(),
  checkOutTime: z.string(),
  version: z.number().int(),
});
export type Property = z.infer<typeof property>;
export type PropertyInput = z.infer<typeof propertyInput>;

export const policyValue = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['default', 'organization', 'brand', 'region', 'property']),
  isLocalOverride: z.boolean(),
});
export type ResolvedPolicy = z.infer<typeof policyValue>;

export const dataDomain = z.enum([
  'reservations',
  'availability',
  'rates',
  'guestProfiles',
  'charges',
  'payments',
  'roomStatus',
  'maintenance',
  'accounting',
]);
export type DataDomain = z.infer<typeof dataDomain>;
export const dataAuthority = z.object({
  domain: dataDomain,
  authority: z.enum(['portico', 'external']),
  connectionId: z.uuid().nullable(),
  systemName: z.string().nullable(),
  writeMode: z.enum(['exclusive', 'forward', 'read_only']),
  isDefault: z.boolean(),
});
export type DataAuthority = z.infer<typeof dataAuthority>;
