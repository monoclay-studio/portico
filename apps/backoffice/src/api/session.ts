import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * Staff session. The bearer token lives in sessionStorage (per tab, cleared when the browser closes) — shared
 * desk computers must not keep staff signed in across browser restarts. Idle/absolute expiry is enforced by
 * the server; the client also drops the session once `expiresAt` passes.
 */
const KEY = 'portico.session.v1';

const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  userId: z.string(),
  organization: z.object({ id: z.string(), name: z.string(), environment: z.string() }),
});
export type Session = z.infer<typeof sessionSchema>;

const listeners = new Set<() => void>();
let cached: Session | null | undefined;
let endedReason: 'expired' | 'signed_out' | null = null;

function read(): Session | null {
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? sessionSchema.safeParse(JSON.parse(raw)) : null;
    cached = parsed?.success ? parsed.data : null;
  } catch {
    cached = null;
  }
  if (cached && new Date(cached.expiresAt).getTime() <= Date.now()) cached = null;
  return cached;
}

function emit() {
  for (const l of listeners) l();
}

export const sessionStore = {
  get: read,
  set(session: Session) {
    cached = session;
    endedReason = null;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      // Private mode / storage blocked: keep the session in memory for this tab.
    }
    emit();
  },
  clear(reason: 'expired' | 'signed_out') {
    cached = null;
    endedReason = reason;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    emit();
  },
  /** Why the last session ended (shown on the sign-in page). */
  get endedReason() {
    return endedReason;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Test helper. */
  reset() {
    cached = undefined;
    endedReason = null;
  },
};

export function useSession(): Session | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null);
}
