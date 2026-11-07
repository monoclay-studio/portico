import { useMemo } from 'react';
import { scopeKey } from '../api/queries';
import { useApp } from '../app/app-context';
import { type PropertyContext, propertyContext } from './property';
import { bindWorkspaceSources, type DomainId, type WorkspaceSources } from './sources';

/**
 * The workspace sources bound for the signed-in organization's environment, the property in view, and a
 * user-scoped query key builder (P0-1: keys always carry organization and user).
 */
export function useWorkspace() {
  const { session, property } = useApp();
  const environment = session.organization.environment;
  const bound = useMemo(() => bindWorkspaceSources(environment), [environment]);
  const ctx: PropertyContext | null = useMemo(
    () => (property ? propertyContext(property) : null),
    [property],
  );
  return {
    property: ctx,
    sources: bound.sources,
    modes: bound.modes,
    source<D extends DomainId>(d: D): WorkspaceSources[D] | undefined {
      return bound.sources[d];
    },
    key: (domain: DomainId, ...rest: readonly unknown[]) =>
      scopeKey(session, 'ws', domain, ctx?.id, ctx?.businessDate, ...rest),
  };
}
