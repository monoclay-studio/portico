import type { LocalDate } from './dates';

export interface Occupancy {
  readonly adults: number;
  readonly childrenAges: readonly number[];
}

export interface EntityRef {
  readonly type: string;
  readonly id: string;
}

export const ref = (type: string, id: string): EntityRef => ({ type, id });

export function totalGuests(o: Occupancy): number {
  return o.adults + o.childrenAges.length;
}

export type { LocalDate };
