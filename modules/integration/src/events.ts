/** Event types emitted by the integration module, and its consumers of other modules' events. */
import type { TxEventSubscription } from '@portico/db';
import { PUBLIC_WEBHOOK_EVENTS } from './domain/webhooks';
import { fanOutEvent } from './service/webhooks';

export const INTEGRATION_EVENTS = {
  /** Domain map. Payload: { connectionId, propertyIds, state: {from,to}, health: {from,to}, reason }. */
  connectionStatusChanged: 'integration.connection.statusChanged',
  /** Domain map. */
  exceptionRaised: 'integration.exception.raised',
  exceptionResolved: 'integration.exception.resolved',
  mappingChanged: 'integration.mapping.changed',
  /** Additive: an inbound record was applied; owning modules mirror it (canonical payload, provenance). */
  inboundApplied: 'integration.inbound.applied',
  /** Additive (spec "forward.acknowledged|rejected"): outcome of an outbound command. */
  outboundAcknowledged: 'integration.outbound.acknowledged',
  outboundRejected: 'integration.outbound.rejected',
  outboundCancelled: 'integration.outbound.cancelled',
  outboundExported: 'integration.outbound.exported',
  syncRunCompleted: 'integration.syncRun.completed',
  credentialsExpiring: 'integration.credentials.expiring',
  webhookDeliveryFailed: 'integration.webhookDelivery.failed',
} as const;

/** Outbox consumers registered in the composition root. */
export function integrationSubscriptions(): TxEventSubscription[] {
  return [
    {
      consumer: 'integration.webhooks.fanout',
      types: PUBLIC_WEBHOOK_EVENTS.map((e) => e.type),
      async handle(tx, event) {
        await fanOutEvent(tx, event);
      },
    },
  ];
}
