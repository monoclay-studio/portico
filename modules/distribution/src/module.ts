/**
 * Module factory for the composition root: builds the distribution deps (Channex adapter over the real HTTPS
 * transport and the persisted simulator), binds the simulator's webhook sink to the same receiver as the public
 * endpoint, and returns the HTTP module, event subscriptions, scheduled jobs and search provider.
 */
import type { PorticoDatabase, ScheduledJob, SearchProvider, TxEventSubscription } from '@portico/db';
import type { HttpModule } from '@portico/http';
import { channexAdapter } from './adapters/channex/client';
import { ChannexSimulatorHub } from './adapters/channex/simulator-hub';
import { CHANNEX_HOSTS } from './adapters/channex/wire';
import { fixedHostHttpTransport } from './adapters/http-transport';
import type { HubTransport } from './adapters/hub';
import type { DistributionPorts } from './ports';
import { distributionHttp } from './routes';
import { distributionSearch } from './search';
import { DEFAULT_CONFIG, type DistributionConfig, type DistributionDeps } from './service/common';
import { distributionJobs, distributionSubscriptions } from './service/jobs';
import { endpointIdFromUrl, receiveWebhook } from './service/webhooks';

export interface DistributionModule {
  deps: DistributionDeps;
  http: HttpModule;
  subscriptions: TxEventSubscription[];
  jobs: ScheduledJob[];
  search: SearchProvider;
}

export function createDistribution(input: {
  database: PorticoDatabase;
  ports: DistributionPorts;
  /** Real hub transport (defaults to HTTPS restricted to the Channex hosts). */
  http?: HubTransport;
  config?: Partial<DistributionConfig>;
  onJobError?: (tenantId: string, err: unknown) => void;
}): DistributionModule {
  const simulator = new ChannexSimulatorHub(input.database);
  const http =
    input.http ?? fixedHostHttpTransport({ allowedHosts: [CHANNEX_HOSTS.production, CHANNEX_HOSTS.staging] });
  const deps: DistributionDeps = {
    ports: input.ports,
    hub: channexAdapter({
      http,
      simulator: (tenantId, propertyId) => simulator.transport(tenantId, propertyId),
    }),
    simulator,
    config: { ...DEFAULT_CONFIG, ...input.config },
  };
  simulator.setSink({
    async deliver(d) {
      const endpointId = endpointIdFromUrl(d.callbackUrl);
      if (!endpointId) return { status: 404 };
      const r = await receiveWebhook(input.database, deps, {
        endpointId,
        headers: d.headers,
        rawBody: d.rawBody,
      });
      return { status: r.status };
    },
  });
  return {
    deps,
    http: distributionHttp({ database: input.database, deps }),
    subscriptions: distributionSubscriptions(deps),
    jobs: distributionJobs(deps, input.onJobError ? { onError: input.onJobError } : {}),
    search: distributionSearch,
  };
}
