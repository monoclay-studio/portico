import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Controlled/uncontrolled state helper used by inputs and pickers. */
export function useControllableState<T>(opts: {
  value?: T | undefined;
  defaultValue: T;
  onChange?: ((value: T) => void) | undefined;
}): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(opts.defaultValue);
  const controlled = opts.value !== undefined;
  const value = controlled ? (opts.value as T) : inner;
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setInner(next);
      onChangeRef.current?.(next);
    },
    [controlled],
  );
  return [value, set];
}

/** True on macOS/iOS, where the primary modifier is ⌘ instead of Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform ?? '');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Global keyboard shortcut. `combo` like 'mod+k', '?', 'g a' (sequence), 'shift+/'. `mod` is ⌘ on Apple, Ctrl
 * elsewhere. Single-key shortcuts are ignored while typing in a field.
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: { enabled?: boolean } = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const steps = combo.split(' ');
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const matches = (e: KeyboardEvent, step: string) => {
      const parts = step.split('+');
      const key = parts[parts.length - 1] ?? '';
      const needMod = parts.includes('mod');
      const needShift = parts.includes('shift');
      const needAlt = parts.includes('alt');
      const mod = isApplePlatform() ? e.metaKey : e.ctrlKey;
      if (needMod !== mod) return false;
      if (needAlt !== e.altKey) return false;
      if (needShift && !e.shiftKey) return false;
      return e.key.toLowerCase() === key.toLowerCase();
    };
    const onKey = (e: KeyboardEvent) => {
      // A focused widget already handled this key (e.g. `e` or `j` in a data grid): never act twice.
      if (e.defaultPrevented) return;
      const step = steps[index] ?? '';
      const hasModifier = step.includes('mod+') || step.includes('alt+');
      if (!hasModifier && isEditableTarget(e.target)) return;
      if (matches(e, step)) {
        if (index === steps.length - 1) {
          index = 0;
          e.preventDefault();
          handlerRef.current(e);
        } else {
          index += 1;
          clearTimeout(timer);
          timer = setTimeout(() => {
            index = 0;
          }, 1200);
        }
      } else if (index > 0 && !['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) {
        index = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [combo, enabled]);
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Browser connectivity. `navigator.onLine === true` does not prove the API is reachable; combine with API health. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Returns `prefers-reduced-motion` (or an explicit data-motion="reduce" on <html>). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      mq?.addEventListener?.('change', cb);
      return () => mq?.removeEventListener?.('change', cb);
    },
    () =>
      document.documentElement.dataset.motion === 'reduce' ||
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    () => false,
  );
}
