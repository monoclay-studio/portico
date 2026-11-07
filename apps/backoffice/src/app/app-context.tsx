import { createContext, useContext } from 'react';
import type { Me, Organization, Property } from '../api';
import type { Session } from '../api/session';
import type { Workspace } from './workspaces';

export interface AppContextValue {
  session: Session;
  me: Me;
  organization: Organization;
  properties: Property[];
  /** Currently selected property (null when the organization has none yet). */
  property: Property | null;
  setPropertyId: (id: string) => void;
  workspaces: Workspace[];
  openPalette: () => void;
  openShortcuts: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside the signed-in app shell');
  return ctx;
}

const PROPERTY_KEY = (orgId: string) => `portico.property.${orgId}`;

export function rememberedPropertyId(orgId: string): string | null {
  try {
    return localStorage.getItem(PROPERTY_KEY(orgId));
  } catch {
    return null;
  }
}

export function rememberPropertyId(orgId: string, id: string) {
  try {
    localStorage.setItem(PROPERTY_KEY(orgId), id);
  } catch {
    // per-viewer convenience only
  }
}
