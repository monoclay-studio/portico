import type { Me } from '../api';

/**
 * Role workspaces (vision: "the front desk sees arrivals and blockers, housekeeping sees rooms and
 * priorities"). Two-level navigation: an icon rail of workspaces + the section list of the active workspace,
 * both filtered by role and property profile (progressive disclosure). Navigation is a UI convenience; the
 * server enforces permissions.
 */
export type WorkspaceId = 'overview' | 'frontDesk' | 'reservations' | 'housekeeping' | 'settings';

export type AppPath =
  | '/today'
  | '/my-work'
  | '/learn'
  | '/front-desk/arrivals'
  | '/housekeeping'
  | '/reservations/timeline'
  | '/settings/organization'
  | '/settings/properties'
  | '/settings/legal-entities'
  | '/settings/users';

export interface NavItem {
  to: AppPath;
  labelKey: string;
  /** Go-to shortcut (G then key). */
  goKey?: string;
  /** Stable help anchor for the screen. */
  helpKey: string;
  /** Only for these property profiles (progressive disclosure); omitted = every profile. */
  profiles?: readonly string[];
}

export interface Workspace {
  id: WorkspaceId;
  labelKey: string;
  roles: readonly string[];
  items: readonly NavItem[];
}

const ALL_STAFF = [
  'org_admin',
  'general_manager',
  'front_desk',
  'reservations_agent',
  'night_auditor',
  'housekeeping_supervisor',
  'housekeeping_attendant',
  'engineer',
  'finance',
  'revenue_manager',
  'read_only',
];

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    roles: ALL_STAFF,
    items: [
      { to: '/today', labelKey: 'nav.today', goKey: 'd', helpKey: 'overview.today' },
      { to: '/my-work', labelKey: 'nav.myWork', goKey: 'w', helpKey: 'overview.myWork' },
      { to: '/learn', labelKey: 'nav.learn', goKey: 'l', helpKey: 'learning.centre' },
    ],
  },
  {
    id: 'frontDesk',
    labelKey: 'nav.frontDesk',
    roles: ['org_admin', 'general_manager', 'front_desk', 'night_auditor'],
    items: [{ to: '/front-desk/arrivals', labelKey: 'nav.arrivals', goKey: 'a', helpKey: 'frontDesk.arrivals' }],
  },
  {
    id: 'reservations',
    labelKey: 'nav.reservations',
    roles: ['org_admin', 'general_manager', 'reservations_agent', 'front_desk', 'revenue_manager', 'night_auditor'],
    items: [{ to: '/reservations/timeline', labelKey: 'nav.timeline', goKey: 't', helpKey: 'reservations.timeline' }],
  },
  {
    id: 'housekeeping',
    labelKey: 'nav.housekeeping',
    roles: [
      'org_admin',
      'general_manager',
      'housekeeping_supervisor',
      'housekeeping_attendant',
      'front_desk',
      'engineer',
    ],
    items: [{ to: '/housekeeping', labelKey: 'nav.housekeepingBoard', goKey: 'h', helpKey: 'housekeeping.board' }],
  },
  {
    id: 'settings',
    labelKey: 'nav.settings',
    roles: ['org_admin', 'general_manager', 'finance'],
    items: [
      { to: '/settings/organization', labelKey: 'nav.organization', helpKey: 'settings.organization' },
      { to: '/settings/properties', labelKey: 'nav.properties', goKey: 'p', helpKey: 'settings.properties' },
      { to: '/settings/legal-entities', labelKey: 'nav.legalEntities', helpKey: 'settings.legalEntities' },
      { to: '/settings/users', labelKey: 'nav.users', goKey: 'u', helpKey: 'settings.users' },
    ],
  },
];

export function workspacesFor(
  me: Pick<Me, 'roles'> | null | undefined,
  profile?: string | null,
): Workspace[] {
  const keys = new Set((me?.roles ?? []).map((r) => r.key));
  return WORKSPACES.filter((w) => w.roles.some((r) => keys.has(r)))
    .map((w) => ({ ...w, items: w.items.filter((i) => !i.profiles || !profile || i.profiles.includes(profile)) }))
    .filter((w) => w.items.length > 0);
}

export function canOpen(me: Pick<Me, 'roles'> | null | undefined, to: AppPath): boolean {
  return workspacesFor(me).some((w) => w.items.some((i) => i.to === to));
}

/** First screen for the role: the most operational workspace wins over the overview. */
export function homeFor(me: Pick<Me, 'roles'> | null | undefined): AppPath | null {
  const ws = workspacesFor(me);
  const keys = new Set((me?.roles ?? []).map((r) => r.key));
  if (keys.has('front_desk')) return '/front-desk/arrivals';
  if (keys.has('housekeeping_supervisor') || keys.has('housekeeping_attendant')) return '/housekeeping';
  if (keys.has('reservations_agent')) return '/reservations/timeline';
  return ws[0]?.items[0]?.to ?? null;
}

export function workspaceOf(pathname: string): WorkspaceId | null {
  for (const w of WORKSPACES) if (w.items.some((i) => pathname.startsWith(i.to))) return w.id;
  return null;
}

export function helpKeyFor(pathname: string): string | null {
  for (const w of WORKSPACES) for (const i of w.items) if (pathname.startsWith(i.to)) return i.helpKey;
  return null;
}
