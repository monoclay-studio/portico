import { Building2, CalendarRange, ConciergeBell, Hotel, Landmark, type LucideIcon, Sparkles, Users } from 'lucide-react';
import type { NavItem } from '../workspaces';

export const NAV_ICONS: Record<NavItem['to'], LucideIcon> = {
  '/front-desk/arrivals': ConciergeBell,
  '/housekeeping': Sparkles,
  '/reservations/timeline': CalendarRange,
  '/admin/organization': Building2,
  '/admin/properties': Hotel,
  '/admin/legal-entities': Landmark,
  '/admin/users': Users,
};
