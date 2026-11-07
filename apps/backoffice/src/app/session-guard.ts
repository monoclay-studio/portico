import type { QueryClient } from '@tanstack/react-query';
import { type Session, sessionStore } from '../api/session';
import { recentRecords } from '../records/stores';

const identityOf = (s: Session | null) => (s ? `${s.organization.id}:${s.userId}:${s.token}` : null);

/**
 * Shared desk computers (owner Q3): whenever the signed-in identity changes — sign-in, sign-out, an expired
 * session, switching organization — drop every cached response, so the next person never sees the previous
 * person's data, even for a moment. Recently opened records (which name guests) are removed when a session ends.
 */
export function guardSessionChanges(queryClient: QueryClient): () => void {
  let current = identityOf(sessionStore.get());
  let lastUser = sessionStore.get()?.userId ?? null;
  return sessionStore.subscribe(() => {
    const s = sessionStore.get();
    const next = identityOf(s);
    if (next === current) return;
    queryClient.clear();
    if (!s && lastUser) recentRecords.clear(lastUser);
    current = next;
    lastUser = s?.userId ?? lastUser;
  });
}
