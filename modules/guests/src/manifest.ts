import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Entitlement gating cross-property profile sharing (platform plans: Enterprise). */
export const CROSS_PROPERTY_FEATURE = 'portfolio.crossPropertyProfiles';

export const guestsManifest: ModuleManifest = {
  name: 'guests',
  schema: 'guests',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  features: [CROSS_PROPERTY_FEATURE],
  // `type` equals the audit target.type (powers GET /v1/records/{type}/{id}/history).
  recordTypes: [
    {
      type: 'guest_profile',
      label: 'Guest',
      readPermission: 'guests.profile.read',
      route: '/guests/profiles/:id',
    },
    {
      type: 'company',
      label: 'Company / travel agent',
      readPermission: 'guests.company.read',
      route: '/guests/companies/:id',
    },
    { type: 'identity_document', label: 'Identity document', readPermission: 'guests.document.read' },
    { type: 'special_need', label: 'Special need', readPermission: 'guests.sensitive.read' },
    { type: 'duplicate_candidate', label: 'Possible duplicate', readPermission: 'guests.profile.merge' },
  ],
  permissions: [
    {
      key: 'guests.profile.read',
      description: 'View guest profiles known at the property (contacts, preferences, alerts, stay history)',
      scope: 'property',
    },
    {
      key: 'guests.profile.readShared',
      description:
        'View shared fields of guest profiles from other properties of the organization (when sharing is enabled)',
      scope: 'property',
    },
    {
      key: 'guests.profile.update',
      description: 'Create and edit guest profiles, contacts, preferences, relationships and consent records',
      scope: 'property',
    },
    {
      key: 'guests.profile.merge',
      description: 'Merge duplicate guest profiles (re-points references in every module)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.profile.unmerge',
      description: 'Reverse a profile merge',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.alert.manage',
      description: 'Raise and resolve guest alerts',
      scope: 'property',
    },
    {
      key: 'guests.note.readPrivate',
      description: 'Read department-restricted guest notes beyond your own',
      scope: 'property',
    },
    {
      key: 'guests.sensitive.read',
      description: 'Read special-needs / health details of guests (every read is audited)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.document.read',
      description: 'Reveal identity document numbers and details (every view is audited)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.document.manage',
      description: 'Capture, replace and delete identity documents',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.privacy.export',
      description: 'Produce a data-subject access/export of everything held about a guest',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'guests.privacy.erase',
      description: 'Erase (anonymize) a guest on request, keeping legally retained financial references',
      scope: 'property',
      sensitive: true,
    },
    { key: 'guests.company.read', description: 'View companies and travel agents', scope: 'property' },
    {
      key: 'guests.company.manage',
      description: 'Create and edit companies and travel agents, contacts and commission terms',
      scope: 'property',
    },
  ],
};
