import type { PorticoDatabase, TxContext } from '@portico/db';
import type { RequestContext } from '@portico/kernel';
import type { ChangeRequest, NewBookingInput } from '../contracts';
import type { ReservationsPorts } from '../ports';
import * as authority from './authority';
import * as bookings from './bookings';
import * as changes from './changes';
import * as channel from './channel';
import { DEFAULT_CONFIG, type Deps, type ServiceConfig } from './context';
import * as frontDesk from './front-desk';
import * as handover from './handover';
import * as issues from './issues';
import * as provider from './provider';
import { reservationsSubscriptions } from './subscriptions';
import * as workflows from './workflows';

type Tail<F> = F extends (deps: Deps, ...rest: infer R) => infer O ? (...rest: R) => O : never;

function bind<F extends (deps: Deps, ...rest: never[]) => unknown>(deps: Deps, fn: F): Tail<F> {
  return ((...rest: never[]) => fn(deps, ...rest)) as Tail<F>;
}

/**
 * The reservations application service, bound to its ports. Every function takes the command's TxContext first
 * (one transaction per command), except the few that orchestrate several transactions on purpose
 * (`commitChangeSafely`: stale-preview recovery; `performWorkflow`: one transaction per check-in step).
 */
export function reservationsService(ports: ReservationsPorts, config: Partial<ServiceConfig> = {}) {
  const deps: Deps = { ports, config: { ...DEFAULT_CONFIG, ...config } };
  return {
    deps,
    // bookings
    quote: bind(deps, bookings.quote),
    createBooking: (tx: TxContext, input: NewBookingInput) => bookings.createBooking(deps, tx, input),
    createWalkIn: bind(deps, bookings.createWalkIn),
    transitionBooking: bind(deps, bookings.transitionBooking),
    expireBookings: bind(deps, bookings.expireBookings),
    patchBooking: bind(deps, bookings.patchBooking),
    patchStay: bind(deps, bookings.patchStay),
    assignUnit: bind(deps, bookings.assignUnit),
    markNoShow: bind(deps, bookings.markNoShow),
    confirmWaitlistedStay: bind(deps, bookings.confirmWaitlistedStay),
    getBooking: bind(deps, bookings.getBooking),
    getBookingByStay: bind(deps, bookings.getBookingByStay),
    listBookings: (tx: TxContext, q: Parameters<typeof bookings.listBookings>[1]) =>
      bookings.listBookings(tx, q),
    // change previews
    previewChange: (tx: TxContext, request: ChangeRequest) => changes.previewChange(deps, tx, request),
    commitChange: bind(deps, changes.commitChange),
    commitChangeSafely: (
      database: PorticoDatabase,
      ctx: RequestContext,
      input: { previewToken: string },
      run?: <T>(fn: (tx: TxContext) => Promise<T>) => Promise<T>,
    ) => changes.commitChangeSafely(deps, database, ctx, input, run),
    // workflows
    startWorkflow: bind(deps, workflows.startWorkflow),
    getWorkflow: bind(deps, workflows.getWorkflow),
    runStep: bind(deps, workflows.runStep),
    skipStep: bind(deps, workflows.skipStep),
    performWorkflow: bind(deps, workflows.performWorkflow),
    // front desk
    listArrivals: bind(deps, frontDesk.listArrivals),
    listDepartures: bind(deps, frontDesk.listDepartures),
    listInHouse: bind(deps, frontDesk.listInHouse),
    // handover
    addHandoverItem: handover.addHandoverItem,
    resolveHandoverItem: handover.resolveHandoverItem,
    openHandoverItems: handover.openHandoverItems,
    publishHandover: handover.publishHandover,
    acknowledgeHandover: handover.acknowledgeHandover,
    getHandover: handover.getHandover,
    listHandovers: handover.listHandovers,
    // issues, relocation, authority
    listIssues: issues.listIssues,
    resolveIssue: issues.resolveIssue,
    listRelocationCases: issues.listRelocationCases,
    resolveRelocationCase: issues.resolveRelocationCase,
    acknowledgeForwardedChange: authority.acknowledgeForwardedChange,
    listForwardedChanges: authority.listForwardedChanges,
    // channel ingestion & domain-map provider functions
    ingestChannelBooking: bind(deps, channel.ingestChannelBooking),
    getStay: bind(deps, provider.getStay),
    listInHouseStaysForNight: bind(deps, provider.listInHouseStaysForNight),
    listDueArrivals: bind(deps, provider.listDueArrivals),
    listDueDepartures: bind(deps, provider.listDueDepartures),
    subscriptions: () => reservationsSubscriptions(deps),
  };
}

export type ReservationsService = ReturnType<typeof reservationsService>;

/**
 * The provider API other modules call (docs/architecture/domain-map.md "reservations (provider)"), bound in the
 * composition root: day-close, distribution, groups, resort, comms.
 */
export function reservationsProvider(service: ReservationsService) {
  return {
    getStay: service.getStay,
    getBooking: service.getBooking,
    listInHouseStaysForNight: service.listInHouseStaysForNight,
    listDueArrivals: service.listDueArrivals,
    listDueDepartures: service.listDueDepartures,
    markNoShow: service.markNoShow,
    ingestChannelBooking: service.ingestChannelBooking,
  };
}
export type ReservationsProvider = ReturnType<typeof reservationsProvider>;

export { type ForwardedResult, isForwarded } from './authority';
export type { NoShowResult } from './bookings';
export type { CommitResult, KeyEffect } from './changes';
export type { ServiceConfig } from './context';
export { environmentAccessAdapter } from './keys';
export type { StayForPosting } from './provider';
