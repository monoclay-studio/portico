import { createDatabase } from '@portico/db';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const database = createDatabase({
  connectionString: config.APP_DATABASE_URL,
  max: config.DB_POOL_MAX,
  applicationName: 'portico-api',
});
const app = await buildApp({
  database,
  logger: { level: config.LOG_LEVEL },
  corsOrigins: config.CORS_ORIGINS.split(','),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.PORT });
