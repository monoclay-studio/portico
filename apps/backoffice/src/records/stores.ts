import { useSyncExternalStore } from 'react';

/** Recent and pinned records per staff member — a per-viewer convenience kept in this browser. */
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
