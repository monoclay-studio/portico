import { createContext, useContext, useEffect, useRef } from 'react';

/** Screens register their verb handlers (N = new) so one global key map works everywhere. */
export type ScreenVerb = 'new';

export interface ScreenActionsRegistry {
  handlers: Map<ScreenVerb, () => void>;
}

export const ScreenActionsContext = createContext<ScreenActionsRegistry>({ handlers: new Map() });

export function useScreenAction(verb: ScreenVerb, handler: () => void) {
  const registry = useContext(ScreenActionsContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = () => ref.current();
    registry.handlers.set(verb, fn);
    return () => {
      if (registry.handlers.get(verb) === fn) registry.handlers.delete(verb);
    };
  }, [registry, verb]);
}
