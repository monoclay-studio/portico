import {
  BedDouble,
  Building2,
  CalendarRange,
  ConciergeBell,
  GraduationCap,
  Hotel,
  Inbox,
  Landmark,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import type { AppPath, WorkspaceId } from '../workspaces';

export const NAV_ICONS: Record<AppPath, LucideIcon> = {
  '/today': Sun,
  '/my-work': Inbox,
  '/learn': GraduationCap,
  '/front-desk/arrivals': ConciergeBell,
  '/front-desk/in-house': BedDouble,
  '/front-desk/departures': LogOut,
  '/housekeeping': Sparkles,
  '/reservations/timeline': CalendarRange,
  '/settings/organization': Building2,
  '/settings/properties': Hotel,
  '/settings/legal-entities': Landmark,
  '/settings/users': Users,
};

export const WORKSPACE_ICONS: Record<WorkspaceId, LucideIcon> = {
  overview: LayoutDashboard,
  frontDesk: ConciergeBell,
  reservations: CalendarRange,
  housekeeping: Sparkles,
  settings: Settings,
};
