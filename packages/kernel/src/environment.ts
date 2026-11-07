import type { RequestContext, TenantEnvironment } from './context';
import { DomainError } from './errors';

/** Categories of real-world side effects that environment safety controls. */
export type ExternalEffect =
  | 'payment.charge' // authorize, capture, charge, refund real money
  | 'message.guest' // email / SMS / WhatsApp / push to guests
  | 'message.staff' // notifications to staff outside the app
  | 'channel.publish' // push availability/rates/restrictions or acks to live channels
  | 'government.submit' // fiscal / tax / guest registration submissions
  | 'ai.inference' // paid AI usage
  | 'credentials.production' // issuing production API keys / webhooks to third parties
  | 'access.key' // door lock / mobile key issuance
  | 'integration.read' // reading from a hotel's existing external systems (authorized connections)
  | 'integration.write'; // creating/updating records in a hotel's external systems

/**
 * How an adapter must behave for an effect:
 *  - live: perform for real (still subject to the integration being configured & approved)
 *  - sandbox: use the provider's sandbox/test mode only
 *  - simulate: use Portico's built-in simulator; label results "simulated"
 *  - blocked: do nothing; surface as unavailable
 */
export type EffectMode = 'live' | 'sandbox' | 'simulate' | 'blocked';

/**
 * Environment policy. `trial` = isolated organization holding an authorized COPY of a hotel's data: it may read
 * from the hotel's real systems through approved read-only connections, but can never write to them, charge
 * cards, message guests, publish to channels, issue keys or submit to governments.
 */
const POLICY: Record<TenantEnvironment, Record<ExternalEffect, EffectMode>> = {
  live: {
    'payment.charge': 'live',
    'message.guest': 'live',
    'message.staff': 'live',
    'channel.publish': 'live',
    'government.submit': 'live',
    'ai.inference': 'live',
    'credentials.production': 'live',
    'access.key': 'live',
    'integration.read': 'live',
    'integration.write': 'live',
  },
  trial: {
    'payment.charge': 'simulate',
    'message.guest': 'simulate',
    'message.staff': 'simulate',
    'channel.publish': 'simulate',
    'government.submit': 'blocked',
    'ai.inference': 'simulate',
    'credentials.production': 'blocked',
    'access.key': 'simulate',
    'integration.read': 'live',
    'integration.write': 'blocked',
  },
  sandbox: {
    'payment.charge': 'sandbox',
    'message.guest': 'simulate',
    'message.staff': 'simulate',
    'channel.publish': 'sandbox',
    'government.submit': 'blocked',
    'ai.inference': 'sandbox',
    'credentials.production': 'blocked',
    'access.key': 'simulate',
    'integration.read': 'sandbox',
    'integration.write': 'sandbox',
  },
  training: {
    'payment.charge': 'simulate',
    'message.guest': 'simulate',
    'message.staff': 'simulate',
    'channel.publish': 'simulate',
    'government.submit': 'blocked',
    'ai.inference': 'simulate',
    'credentials.production': 'blocked',
    'access.key': 'simulate',
    'integration.read': 'simulate',
    'integration.write': 'simulate',
  },
  demo: {
    'payment.charge': 'simulate',
    'message.guest': 'simulate',
    'message.staff': 'simulate',
    'channel.publish': 'simulate',
    'government.submit': 'blocked',
    'ai.inference': 'simulate',
    'credentials.production': 'blocked',
    'access.key': 'simulate',
    'integration.read': 'simulate',
    'integration.write': 'simulate',
  },
};

export function effectMode(ctx: Pick<RequestContext, 'environment'>, effect: ExternalEffect): EffectMode {
  return POLICY[ctx.environment][effect];
}

/** Adapters call this before any real-world effect. Throws when blocked; returns the mode otherwise. */
export function assertExternalEffectAllowed(
  ctx: Pick<RequestContext, 'environment'>,
  effect: ExternalEffect,
): Exclude<EffectMode, 'blocked'> {
  const mode = effectMode(ctx, effect);
  if (mode === 'blocked') {
    throw new DomainError(
      'effect_blocked_in_environment',
      `This action (${effect}) is disabled in the ${ctx.environment} environment so that nothing real happens. Use the live environment to perform it.`,
      { status: 403, details: { effect, environment: ctx.environment } },
    );
  }
  return mode;
}
