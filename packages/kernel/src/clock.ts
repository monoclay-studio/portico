/** Inject time everywhere; never call `new Date()` in domain code. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(
  start: Date | string,
): Clock & { advance(ms: number): void; set(d: Date | string): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    set(d: Date | string) {
      current = new Date(d);
    },
  };
}
