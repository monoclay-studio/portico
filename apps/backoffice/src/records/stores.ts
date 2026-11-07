import { useSyncExternalStore } from 'react';

/**
 * Recent and pinned records per staff member — a per-viewer convenience kept in this browser. Titles stored here
 * must not identify guests or staff (shared desk computers): use `safeRecordTitle`.
 */
const PERSONAL_TYPES = new Set(['stay', 'guest', 'booking', 'user', 'company']);

/** A title safe to keep in browser storage: the reference code for personal records, never a person's name. */
export function safeRecordTitle(r: {
  type: string;
  title: string;
  code?: string | undefined;
  typeLabel: string;
}): string {
  if (!PERSONAL_TYPES.has(r.type)) return r.title;
  return r.code ? `${r.typeLabel} ${r.code}` : r.typeLabel;
}
export interface RecordRef {
  type: string;
  id: string;
  title: string;
}

function makeStore(prefix: string, max: number) {
  const listeners = new Set<() => void>();
  const cache = new Map<string, RecordRef[]>();
  const key = (userId: string) => `portico.${prefix}.${userId}`;
  const read = (userId: string): RecordRef[] => {
    const cached = cache.get(userId);
    if (cached) return cached;
    let list: RecordRef[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? '[]');
      if (Array.isArray(parsed))
        list = parsed.filter((x): x is RecordRef => typeof x?.type === 'string' && typeof x?.id === 'string');
    } catch {
      list = [];
    }
    cache.set(userId, list);
    return list;
  };
  const write = (userId: string, list: RecordRef[]) => {
    cache.set(userId, list);
    try {
      localStorage.setItem(key(userId), JSON.stringify(list));
    } catch {
      // storage blocked
    }
    for (const l of listeners) l();
  };
  return {
    read,
    add(userId: string, ref: RecordRef) {
      write(
        userId,
        [ref, ...read(userId).filter((r) => !(r.type === ref.type && r.id === ref.id))].slice(0, max),
      );
    },
    remove(userId: string, ref: Pick<RecordRef, 'type' | 'id'>) {
      write(
        userId,
        read(userId).filter((r) => !(r.type === ref.type && r.id === ref.id)),
      );
    },
    clear(userId: string) {
      write(userId, []);
      try {
        localStorage.removeItem(key(userId));
      } catch {
        // storage blocked
      }
    },
    has(userId: string, ref: Pick<RecordRef, 'type' | 'id'>) {
      return read(userId).some((r) => r.type === ref.type && r.id === ref.id);
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const recentRecords = makeStore('recent', 8);
export const pinnedRecords = makeStore('pinned', 12);

type RecordStore = ReturnType<typeof makeStore>;

/** Subscribe to a recent/pinned list for a staff member. */
export function useRecordRefs(store: RecordStore, userId: string): RecordRef[] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.read(userId),
    () => EMPTY_REFS,
  );
}
const EMPTY_REFS: RecordRef[] = [];
