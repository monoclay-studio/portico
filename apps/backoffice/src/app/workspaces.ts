import type { Me } from '../api';

/**
 * Role workspaces (vision: "the front desk sees arrivals and blockers, housekeeping sees rooms and
 * priorities"). Navigation is a UI convenience derived from role keys; the server enforces permissions.
 */
export type WorkspaceId = 'frontDesk' | 'housekeeping' | 'reservations' | 'administration';

export interface NavItem {
  to: '/front-desk/arrivals' | '/housekeeping' | '/reservations/timeline' | '/admin/organization' | '/admin/properties' | '/admin/legal-entities' | '/admin/users';
  labelKey: string;
  shortcut?: string;
}

export interface Workspace {
  id: WorkspaceId;
  labelKey: string;
  roles: readonly string[];
  items: readonly NavItem[];
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'frontDesk',
    labelKey: 'nav.frontDesk',
    roles: ['org_admin', 'general_manager', 'front_desk', 'night_auditor'],
    items: [{ to: '/front-desk/arrivals', labelKey: 'nav.arrivals', shortcut: 'G A' }],
  },
  {
    id: 'housekeeping',
    labelKey: 'nav.housekeeping',
    roles: ['org_admin', 'general_manager', 'housekeeping_supervisor', 'housekeeping_attendant', 'front_desk', 'engineer'],
    items: [{ to: '/housekeeping', labelKey: 'nav.housekeeping', shortcut: 'G H' }],
  },
  {
    id: 'reservations',
    labelKey: 'nav.reservations',
    roles: ['org_admin', 'general_manager', 'reservations_agent', 'front_desk', 'revenue_manager', 'night_auditor'],
    items: [{ to: '/reservations/timeline', labelKey: 'nav.timeline', shortcut: 'G T' }],
  },
  {
    id: 'administration',
    labelKey: 'nav.administration',
    roles: ['org_admin', 'general_manager', 'finance'],
    items: [
      { to: '/admin/organization', labelKey: 'nav.organization' },
      { to: '/admin/properties', labelKey: 'nav.properties' },
      { to: '/admin/legal-entities', labelKey: 'nav.legalEntities' },
      { to: '/admin/users', labelKey: 'nav.users', shortcut: 'G U' },
    ],
  },
];

export function workspacesFor(me: Pick<Me, 'roles'> | null | undefined): Workspace[] {
  const keys = new Set((me?.roles ?? []).map((r) => r.key));
  return WORKSPACES.filter((w) => w.roles.some((r) => keys.has(r)));
}

export function canOpen(me: Pick<Me, 'roles'> | null | undefined, to: NavItem['to']): boolean {
  return workspacesFor(me).some((w) => w.items.some((i) => i.to === to));
}

export function homeFor(me: Pick<Me, 'roles'> | null | undefined): NavItem['to'] | null {
  return workspacesFor(me)[0]?.items[0]?.to ?? null;
}
