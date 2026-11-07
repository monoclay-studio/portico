import type { SavedView } from '@portico/ui';
import { useCallback, useMemo, useState } from 'react';

/**
 * Saved table views: built-in views shipped with the screen + the staff member's own views. Own views are a
 * per-viewer convenience kept in this browser (localStorage) until a server-side preferences API exists.
 */
export function useSavedViews(tableId: string, userId: string, builtIn: readonly SavedView[]) {
  const key = `portico.views.${tableId}.${userId}`;
  const [own, setOwn] = useState<SavedView[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
    } catch {
      return [];
    }
  });
  const persist = useCallback(
    (next: SavedView[]) => {
      setOwn(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: views last for this session only
      }
    },
    [key],
  );
  const views = useMemo(() => [...builtIn, ...own], [builtIn, own]);
  return {
    views,
    onSaveView: (v: SavedView) => persist([...own, v]),
    onDeleteView: (id: string) => persist(own.filter((v) => v.id !== id)),
  };
}
