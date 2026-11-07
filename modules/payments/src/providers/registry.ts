/**
 * Chooses the adapter for an account under the environment-safety policy (ADR-0010):
 *
 *   effect mode 'simulate' (demo / trial / training) → SimulatorProvider, ALWAYS — even for a Stripe account;
 *   effect mode 'sandbox'  → Stripe with TEST keys only (or the simulator for simulator accounts);
 *   effect mode 'live'     → Stripe with LIVE keys; simulator accounts are refused in live;
 *   effect mode 'blocked'  → assertExternalEffectAllowed throws, nothing is attempted.
 *
 * `external_terminal` accounts never have an adapter: Portico only records what the hotel's own terminal did.
 */
import { assertExternalEffectAllowed, BusinessRuleError, type RequestContext } from '@portico/kernel';
import type { HttpClient } from './http-client';
import type { PaymentProvider, ProviderAccount } from './provider';
import type { SimulatorProvider } from './simulator';
import { StripeConnectProvider } from './stripe-connect';

/** Where Monoclay's Connect PLATFORM credentials come from (Secrets Manager in production). Never in code. */
export interface ProviderSecretsPort {
  stripeSecretKey(mode: 'live' | 'sandbox'): string | null;
  stripeWebhookSecrets(mode: 'live' | 'sandbox'): string[];
}

export type ResolvedProvider =
  | { ok: true; provider: PaymentProvider; mode: 'live' | 'sandbox' | 'simulate' }
  | { ok: false; code: 'provider_not_configured'; mode: 'live' | 'sandbox' | 'simulate' };

export interface ProviderRegistry {
  readonly simulator: SimulatorProvider;
  /** The effect mode this context would use (for recording intent BEFORE the call). */
  modeFor(
    ctx: Pick<RequestContext, 'environment'>,
    account: Pick<ProviderAccount, 'provider'>,
  ): 'live' | 'sandbox' | 'simulate';
  forAccount(ctx: Pick<RequestContext, 'environment'>, account: ProviderAccount): ResolvedProvider;
  /** Adapter used to verify a provider's webhooks for a mode (null when not configured). */
  stripeForWebhooks(mode: 'live' | 'sandbox'): StripeConnectProvider | null;
}

export function createProviderRegistry(deps: {
  simulator: SimulatorProvider;
  secrets: ProviderSecretsPort;
  http: HttpClient;
}): ProviderRegistry {
  const modeFor: ProviderRegistry['modeFor'] = (ctx, account) => {
    const mode = assertExternalEffectAllowed(ctx, 'payment.charge');
    if (account.provider === 'external_terminal') {
      throw new BusinessRuleError(
        'recorded_only_account',
        "This account records payments taken on the hotel's own terminal or gateway; Portico cannot send charges through it. Record the payment with its approval code instead.",
      );
    }
    if (mode === 'simulate') return 'simulate';
    if (account.provider === 'simulator') {
      if (mode === 'live') {
        throw new BusinessRuleError(
          'simulator_in_live',
          'A simulated payment account cannot be used in the live environment. Use the hotel’s real payment account, or record the payment taken on the hotel’s own terminal.',
        );
      }
      return 'simulate';
    }
    return mode;
  };

  return {
    simulator: deps.simulator,
    modeFor,
    forAccount(ctx, account) {
      const mode = modeFor(ctx, account);
      if (mode === 'simulate') return { ok: true, provider: deps.simulator, mode };
      const key = deps.secrets.stripeSecretKey(mode);
      if (!key) return { ok: false, code: 'provider_not_configured', mode };
      return {
        ok: true,
        mode,
        provider: new StripeConnectProvider({
          mode,
          secretKey: key,
          webhookSecrets: deps.secrets.stripeWebhookSecrets(mode),
          http: deps.http,
        }),
      };
    },
    stripeForWebhooks(mode) {
      const key = deps.secrets.stripeSecretKey(mode);
      const secrets = deps.secrets.stripeWebhookSecrets(mode);
      if (!key || secrets.length === 0) return null;
      return new StripeConnectProvider({ mode, secretKey: key, webhookSecrets: secrets, http: deps.http });
    },
  };
}

/** Secrets port for environments with no provider credentials (the default until the owner configures Q2/Q3). */
export const noProviderSecrets: ProviderSecretsPort = {
  stripeSecretKey: () => null,
  stripeWebhookSecrets: () => [],
};

/**
 * Secrets from environment variables (development/sandbox). Production binds Secrets Manager. None of these exist
 * yet (owner questions Q2/Q3): with no keys every Stripe call is refused before sending ("not configured").
 *   PAYMENTS_STRIPE_SECRET_KEY_TEST / _LIVE           Monoclay Connect PLATFORM keys (never the SaaS-billing key)
 *   PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST / _LIVE      comma-separated Connect endpoint signing secrets
 */
export function envProviderSecrets(env: Record<string, string | undefined>): ProviderSecretsPort {
  const list = (v: string | undefined) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  return {
    stripeSecretKey: (mode) =>
      (mode === 'live' ? env.PAYMENTS_STRIPE_SECRET_KEY_LIVE : env.PAYMENTS_STRIPE_SECRET_KEY_TEST) || null,
    stripeWebhookSecrets: (mode) =>
      list(
        mode === 'live' ? env.PAYMENTS_STRIPE_WEBHOOK_SECRETS_LIVE : env.PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST,
      ),
  };
}
