import { useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { formatTrail, parseTrail, pushTrail, type TrailEntry } from './trail';

/** Open / step back / close records in the drawer without leaving the current screen. */
export function useRecordNav() {
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const search = location.search as Record<string, unknown>;
  const raw = typeof search.record === 'string' ? search.record : undefined;
  const trail = useMemo(() => parseTrail(raw), [raw]);
  const setTrail = useCallback(
    (next: TrailEntry[]) => {
      void router.navigate({
        to: location.pathname,
        search: { ...search, record: formatTrail(next) },
      } as never);
    },
    [router, location.pathname, search],
  );
  return {
    trail,
    open: (type: string, id: string) => setTrail(pushTrail(trail, { type, id })),
    /** Start a fresh trail (opening from a list). */
    openFresh: (type: string, id: string) => setTrail([{ type, id }]),
    back: () => setTrail(trail.slice(0, -1)),
    close: () => setTrail([]),
    jump: (index: number) => setTrail(trail.slice(0, index + 1)),
  };
}
