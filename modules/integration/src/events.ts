/** Event types emitted by the integration module, and its consumers of other modules' events. */
import type { TxContext, TxEventSubscription } from '@portico/db';
import type { DomainEvent } from '@portico/kernel';
import { PUBLIC_WEBHOOK_EVENTS } from './domain/webhooks';
import type { IntegrationDeps } from './service/common';
import { reprocessAfterAuthoritySwitch } from './service/exchange';
import { fanOutEvent } from './service/webhooks';

export const INTEGRATION_EVENTS = {
  /** Domain map. Payload: { connectionId, propertyIds, state: {from,to}, health: {from,to}, reason }. */
  connectionStatusChanged: 'integration.connection.statusChanged',
  /** Domain map. */
  exceptionRaised: 'integration.exception.raised',
  exceptionResolved: 'integration.exception.resolved',
  mappingChanged: 'integration.mapping.changed',
  /**
   * Additive notification that an inbound record was applied by its owning module's handler (same transaction).
   * Thin: ids and revision only, never guest data. Owning modules apply through the handler port, not this event.
   */
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

/** Platform events after which records held during a change of system of record are applied (F15). */
export const AUTHORITY_SWITCH_EVENTS = [
  'platform.dataAuthority.changed',
  'platform.authorityTransition.completed',
] as const;

/** Outbox consumers registered in the composition root. */
export function integrationSubscriptions(deps?: IntegrationDeps): TxEventSubscription[] {
  return [
    {
      consumer: 'integration.webhooks.fanout',
      types: PUBLIC_WEBHOOK_EVENTS.map((e) => e.type),
      async handle(tx, event) {
        await fanOutEvent(tx, event);
      },
    },
    ...(deps
      ? [
          {
            consumer: 'integration.authority.reprocess',
            types: [...AUTHORITY_SWITCH_EVENTS],
            async handle(tx: TxContext, event: DomainEvent) {
              if (!event.propertyId) return;
              await reprocessAfterAuthoritySwitch(tx, deps, event.propertyId);
            },
          },
        ]
      : []),
  ];
}
