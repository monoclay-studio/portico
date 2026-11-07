import { type PorticoDatabase, sql } from '@portico/db';
import { createServer, type PorticoApp } from '@portico/http';
import { compose } from './composition';

export interface AppOptions {
  database: PorticoDatabase;
  logger?: boolean | { level: string };
  corsOrigins?: string[];
  rateLimit?: false | { max: number; timeWindow: string };
}

export async function buildApp(opts: AppOptions): Promise<PorticoApp> {
  const composition = compose(opts.database);
  return createServer({
    authenticator: composition.authenticator,
    modules: composition.httpModules,
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts.corsOrigins ? { corsOrigins: opts.corsOrigins } : {}),
    ...(opts.rateLimit !== undefined ? { rateLimit: opts.rateLimit } : {}),
    openApi: { title: 'Portico API', version: '1.0.0' },
    readiness: async () => {
      await sql`select 1`.execute(opts.database.kysely);
    },
  });
}
