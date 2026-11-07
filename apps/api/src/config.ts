import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  /** Owner/admin connection used only for migrations. */
  DATABASE_URL: z.string().default('postgres://postgres@127.0.0.1:5432/portico_dev'),
  /** Restricted application role connection (RLS applies). */
  APP_DATABASE_URL: z.string().default('postgres://portico_app:portico_app_dev@127.0.0.1:5432/portico_dev'),
  DB_POOL_MAX: z.coerce.number().int().default(20),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Development-only password for the app role, set by the migrate CLI. Production provisions it via IaC. */
  APP_DB_DEV_PASSWORD: z.string().optional(),
  /** Operator token for the internal provisioning endpoint. Endpoint disabled when unset. */
  OPERATOR_TOKEN: z.string().min(32).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
