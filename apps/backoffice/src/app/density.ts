import { useSyncExternalStore } from 'react';

/** Density mode (design direction): compact desk default, comfortable on request. Remembered per user. */
export type Density = 'compact' | 'comfortable';
const listeners = new Set<() => void>();
let userKey = 'portico.density';

function read(): Density {
  try {
    return localStorage.getItem(userKey) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
}

export function applyDensity(d: Density = read()) {
  document.documentElement.dataset.density = d;
}

export const density = {
  setUser(userId: string) {
    userKey = `portico.density.${userId}`;
    applyDensity();
    for (const l of listeners) l();
  },
  set(d: Density) {
    try {
      localStorage.setItem(userKey, d);
    } catch {
      // per-viewer convenience
    }
    applyDensity(d);
    for (const l of listeners) l();
  },
  toggle() {
    density.set(read() === 'compact' ? 'comfortable' : 'compact');
  },
  use(): Density {
    return useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      read,
      () => 'compact',
    );
  },
};
