export * from './contracts';
export { seedPaymentsDemo } from './demo-seed';
export { explainDecline } from './domain/declines';
export { PaymentsEvents } from './events';
export * from './manifest';
export type { EntityRef, LedgerPaymentMethod, LedgerPort, PlatformPort, PropertyInfo } from './ports';
export { type HttpClient, type HttpRequest, type HttpResponse, HttpTransportError, fetchHttpClient } from './providers/http-client';
export type { PaymentProvider, ProviderAccount, SimulatorControls } from './providers/provider';
export {
  createProviderRegistry,
  noProviderSecrets,
  type ProviderRegistry,
  type ProviderSecretsPort,
} from './providers/registry';
export { SIMULATOR_SIGNATURE_HEADER, SIMULATOR_TEST_TOKENS, SimulatorProvider } from './providers/simulator';
export { STRIPE_SIGNATURE_HEADER, StripeConnectProvider } from './providers/stripe-connect';
export { paymentsHttp } from './routes';
export { paymentsSearch } from './search';
export { createPaymentsService, type PaymentsService, type PaymentsServiceDeps } from './service';
export type { PaymentsDB } from './tables';

import type { PorticoDatabase } from '@portico/db';
import { DEFAULT_BREAKER, type BreakerConfig } from './domain/circuit-breaker';
import type { LedgerPort, PlatformPort } from './ports';
import { fetchHttpClient, type HttpClient } from './providers/http-client';
import { createProviderRegistry, type ProviderSecretsPort } from './providers/registry';
import { SimulatorProvider } from './providers/simulator';
import { paymentsHttp } from './routes';
import { createPaymentsService } from './service';

/** One-call wiring for the composition root. */
export function createPaymentsModule(deps: {
  database: PorticoDatabase;
  ledger: LedgerPort;
  platform: PlatformPort;
  secrets: ProviderSecretsPort;
  /** Signs simulator webhooks (not a real secret: the simulator moves no money). */
  simulatorSigningSecret: string;
  http?: HttpClient;
  breaker?: BreakerConfig;
}) {
  const simulator = new SimulatorProvider(deps.database, deps.simulatorSigningSecret);
  const registry = createProviderRegistry({ simulator, secrets: deps.secrets, http: deps.http ?? fetchHttpClient });
  const service = createPaymentsService({
    database: deps.database,
    ledger: deps.ledger,
    platform: deps.platform,
    registry,
    breaker: deps.breaker ?? DEFAULT_BREAKER,
  });
  return {
    service,
    registry,
    simulator,
    http: paymentsHttp({ database: deps.database, service }),
    subscriptions: service.subscriptions(),
  };
}
