import { Direction, Toast as ToastPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { defaultUiStrings, mergeStrings, type UiStrings, type UiStringsOverride } from './strings';

export interface UiContextValue {
  strings: UiStrings;
  locale: string;
  dir: 'ltr' | 'rtl';
  /** Week start for calendars: 0 Sunday, 1 Monday, 6 Saturday. Maldives commonly uses Sunday–Thursday work weeks. */
  weekStartsOn: number;
}

const UiContext = createContext<UiContextValue>({
  strings: defaultUiStrings,
  locale: 'en',
  dir: 'ltr',
  weekStartsOn: 1,
});

export interface UiProviderProps {
  children: ReactNode;
  strings?: UiStringsOverride | undefined;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  weekStartsOn?: number;
}

/**
 * Root provider for the design system: translated strings, locale, reading direction (RTL), tooltip and toast
 * infrastructure. Mount once near the root of every app.
 */
export function UiProvider({
  children,
  strings,
  locale = 'en',
  dir = 'ltr',
  weekStartsOn = 1,
}: UiProviderProps) {
  const value = useMemo<UiContextValue>(
    () => ({ strings: mergeStrings(defaultUiStrings, strings), locale, dir, weekStartsOn }),
    [strings, locale, dir, weekStartsOn],
  );
  return (
    <UiContext.Provider value={value}>
      <Direction.Provider dir={dir}>
        <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
          <ToastPrimitive.Provider swipeDirection={dir === 'rtl' ? 'left' : 'right'} duration={6000}>
            {children}
          </ToastPrimitive.Provider>
        </TooltipPrimitive.Provider>
      </Direction.Provider>
    </UiContext.Provider>
  );
}

export function useUi(): UiContextValue {
  return useContext(UiContext);
}
