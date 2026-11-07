import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener?.('change', cb);
      return () => mq.removeEventListener?.('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-width layouts switch tables to cards and use 44px+ touch targets (tokens handle sizes). */
export const PHONE_QUERY = '(max-width: 767px)';
