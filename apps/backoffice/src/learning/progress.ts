import { useSyncExternalStore } from 'react';

/**
 * Learning progress per staff member: lessons marked done, first-run events seen, checklist dismissed.
 * Kept in this browser for now (per-viewer); a server-side learning record (training time by role,
 * help-anchor usage — experience architecture §4) is planned with the identity/analytics modules.
 */
interface Progress {
  lessons: string[];
  events: string[];
  checklistDismissed: boolean;
}

const EMPTY: Progress = { lessons: [], events: [], checklistDismissed: false };
const listeners = new Set<() => void>();
const cache = new Map<string, Progress>();
const key = (userId: string) => `portico.learning.${userId}`;

function read(userId: string): Progress {
  const c = cache.get(userId);
  if (c) return c;
  let p = EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) ?? 'null') as Partial<Progress> | null;
    if (parsed)
      p = {
        lessons: parsed.lessons ?? [],
        events: parsed.events ?? [],
        checklistDismissed: Boolean(parsed.checklistDismissed),
      };
  } catch {
    p = EMPTY;
  }
  cache.set(userId, p);
  return p;
}

function write(userId: string, p: Progress) {
  cache.set(userId, p);
  try {
    localStorage.setItem(key(userId), JSON.stringify(p));
  } catch {
    // storage blocked: progress lasts for this session
  }
  for (const l of listeners) l();
}

let currentUser: string | null = null;

export const learning = {
  setUser(userId: string) {
    currentUser = userId;
  },
  /** Record a first-run event, e.g. 'visit:frontDesk.arrivals', 'record:open', 'palette:open'. */
  event(name: string) {
    if (!currentUser) return;
    const p = read(currentUser);
    if (!p.events.includes(name)) write(currentUser, { ...p, events: [...p.events, name] });
  },
  toggleLesson(userId: string, id: string) {
    const p = read(userId);
    write(userId, {
      ...p,
      lessons: p.lessons.includes(id) ? p.lessons.filter((l) => l !== id) : [...p.lessons, id],
    });
  },
  dismissChecklist(userId: string) {
    write(userId, { ...read(userId), checklistDismissed: true });
  },
};

export function useLearningProgress(userId: string): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(userId),
    () => EMPTY,
  );
}
