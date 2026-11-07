/** A permission registered by a module. Key format: `<module>.<resource>.<action>`. */
export interface PermissionDefinition {
  key: string;
  description: string;
  /** Whether this permission is evaluated against a property scope. */
  scope: 'organization' | 'property';
  /** Sensitive permissions (money movement, data export, user admin) are highlighted in role editors. */
  sensitive?: boolean;
}

/** Static description of a module. The composition root collects these. */
export interface ModuleManifest {
  /** Module name, e.g. 'inventory'. */
  name: string;
  /** Postgres schema owned by the module. */
  schema: string;
  /** Absolute path to the module's SQL migrations directory. */
  migrationsDir: string;
  /** Modules whose migrations must run first (only if this module's SQL references them, which is rare). */
  migrateAfter?: string[];
  permissions: PermissionDefinition[];
  /** Feature keys this module gates via entitlements (see platform plans). */
  features?: string[];
}
