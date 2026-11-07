export * as platform from './api';
export * from './contracts';
export type { ActivationScopeContent, ChecklistItem, PropertyStatus, ScopeStage } from './domain/activation';
export type { BundleContent, BundleItem, PlannedItem } from './domain/configuration';
export { DATA_DOMAINS } from './domain/data-authority';
export {
  MODULE_PACKS,
  type ModulePack,
  PLANS,
  type PlanDefinition,
  packByKey,
  planByCode,
} from './domain/plans';
export * from './manifest';
export type * from './ports';
export * from './routes';
export { platformSearch } from './search';
export type { PlatformDB } from './tables';
