import { useSyncExternalStore } from 'react';

/** Whether the Portico API answered the last request (independent of navigator.onLine). */
let reachable = true;
let lastSuccessAt: string | null = null;
const listeners = new Set<() => void>();

export const connectivity = {
  report(ok: boolean) {
    const changed = ok !== reachable;
    reachable = ok;
    if (ok) lastSuccessAt = new Date().toISOString();
    if (changed) for (const l of listeners) l();
  },
  get reachable() {
    return reachable;
  },
  get lastSuccessAt() {
    return lastSuccessAt;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useApiReachable(): boolean {
  return useSyncExternalStore(
    connectivity.subscribe,
    () => connectivity.reachable,
    () => true,
  );
}
