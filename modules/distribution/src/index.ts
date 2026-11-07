export { channexAdapter, SIMULATOR_HOST } from './adapters/channex/client';
export {
  addRevision,
  handleRequest,
  newSimState,
  requestInstants,
  type SimBookingInput,
  type SimState,
} from './adapters/channex/simulator';
export { ChannexSimulatorHub, type WebhookSink } from './adapters/channex/simulator-hub';
export { CHANNEX_HOSTS, WEBHOOK_TOKEN_HEADER, WIRE_FACTS } from './adapters/channex/wire';
export { fixedHostHttpTransport } from './adapters/http-transport';
export type { HubAdapter, HubCallContext, HubTransport } from './adapters/hub';
export * from './contracts';
export { DISTRIBUTION_EVENTS } from './events';
export * from './manifest';
export { createDistribution, type DistributionModule } from './module';
export * from './ports';
export { distributionHttp } from './routes';
export { distributionSearch } from './search';
export { seedDistributionDemo } from './seed';
export { DEFAULT_CONFIG, type DistributionConfig, type DistributionDeps } from './service/common';
export { distributionJobs, distributionSubscriptions, runTenantWork } from './service/jobs';
export * as distribution from './services';
export type { DistributionDB } from './tables';
