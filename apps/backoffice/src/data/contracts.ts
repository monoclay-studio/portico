/**
 * The module contracts the workspaces are typed with. Screens and view models depend on THESE (the real
 * `@portico/<module>/contracts`), never on the simulator, so binding a live source is one adapter per domain.
 */
import { board, boardRow, unitStatus } from '@portico/operations/contracts';
import type { statusPresentation } from '@portico/payments/contracts';
import { frontDeskRow, readinessView, stayStatusFamilies } from '@portico/reservations/contracts';
import { z } from 'zod';

export { board, boardRow, frontDeskRow, readinessView, stayStatusFamilies, unitStatus };

/** Response of GET /v1/front-desk/{arrivals|departures|in-house} (reservations routes). */
export const deskList = z.object({
  date: z.string(),
  businessDate: z.string(),
  items: z.array(frontDeskRow),
  counts: z.record(z.string(), z.number()),
});

export type DeskList = z.infer<typeof deskList>;
export type FrontDeskRow = z.infer<typeof frontDeskRow>;
export type ReadinessView = z.infer<typeof readinessView>;
export type ReadinessCheck = ReadinessView['checks'][number];
export type OperationsBoard = z.infer<typeof board>;
export type BoardRow = z.infer<typeof boardRow>;
export type UnitStatusView = z.infer<typeof unitStatus>;
export type StayStatusFamilies = z.infer<typeof stayStatusFamilies>;
export type PaymentPresentation = z.infer<typeof statusPresentation>;

/** The desk lists reservations serves. */
export type DeskListKind = 'arrivals' | 'departures' | 'in-house';

/** Readiness check keys composed by reservations (domain/readiness.ts). Others may arrive: never assume. */
export const READINESS_KEYS = [
  'unit_assigned',
  'unit_ready',
  'payment_secured',
  'registration',
  'requests',
] as const;
