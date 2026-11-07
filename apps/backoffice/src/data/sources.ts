/**
 * Binding table: which source serves each workspace domain. Today every operational domain is SIMULATED
 * because the reservations / operations / inventory modules are being built in parallel (wave 1). When a
 * module merges, implement a live `WorkspaceDataSource` with its `@portico/<module>/contracts` and switch the
 * binding here — screens do not change, and the provenance badge flips from SIMULATED to live automatically.
 *
 * Real today (API on main): sign-in, session, /me, organization, properties, legal entities, users & roles.
 */
import { createSimulatedSource, type WorkspaceDataSource } from '../mocks/adapter';

export const workspaceSource: WorkspaceDataSource = createSimulatedSource();

export const DOMAIN_BINDINGS = [
  { domain: 'Front desk arrivals', module: 'reservations + operations', mode: workspaceSource.mode },
  { domain: 'Housekeeping board', module: 'operations', mode: workspaceSource.mode },
  { domain: 'Reservations timeline', module: 'reservations + inventory', mode: workspaceSource.mode },
  {
    domain: 'Change preview (extend stay)',
    module: 'reservations + rates + finance',
    mode: workspaceSource.mode,
  },
] as const;

export type { WorkspaceDataSource };
