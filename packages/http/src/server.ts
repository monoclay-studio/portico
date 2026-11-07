import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { type Authenticator, contextFrom } from './auth';
import { errorHandler } from './errors';

export type PorticoApp = FastifyInstance<
  import('node:http').Server,
  import('node:http').IncomingMessage,
  import('node:http').ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

/** A module's HTTP surface. Routes are mounted under /v1. */
export interface HttpModule {
  name: string;
  routes(app: PorticoApp): void | Promise<void>;
}

export interface ServerOptions {
  authenticator: Authenticator;
  modules: readonly HttpModule[];
  logger?: boolean | { level: string };
  corsOrigins?: string[];
  rateLimit?: { max: number; timeWindow: string } | false;
  openApi?: { title: string; version: string } | false;
  /** Extra readiness check (e.g. database ping). */
  readiness?: () => Promise<void>;
}

/** Fields that must never appear in logs. */
export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.cardNumber',
  '*.cvc',
  '*.documentNumber',
  '*.token',
];

export async function createServer(opts: ServerOptions): Promise<PorticoApp> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: typeof opts.logger === 'object' ? opts.logger.level : 'info',
            redact: LOG_REDACT,
            serializers: {
              // Query strings (search terms, filters) can contain personal data: log the path only.
              req: (req: { method: string; url: string; id: string }) => ({
                method: req.method,
                url: req.url.split('?')[0],
                id: req.id,
              }),
            },
          },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w.-]{8,100}$/.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .type('application/problem+json')
      .send({
        type: 'https://docs.portico.app/errors/route_not_found',
        title: 'Not found',
        status: 404,
        code: 'route_not_found',
        detail: `No endpoint ${req.method} ${req.url}. Check the API reference at /v1/docs.`,
        retryable: false,
        correlationId: String(req.id),
      }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: opts.corsOrigins ?? false, credentials: true });
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, {
      max: opts.rateLimit?.max ?? 600,
      timeWindow: opts.rateLimit?.timeWindow ?? '1 minute',
    });
  }

  if (opts.openApi !== false) {
    await app.register(swagger, {
      openapi: {
        info: { title: opts.openApi?.title ?? 'Portico API', version: opts.openApi?.version ?? '1.0.0' },
        components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
        security: [{ bearer: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/v1/docs' });
  }

  app.decorateRequest('auth', null);
  app.decorateRequest('ctx', {
    getter(this: import('fastify').FastifyRequest) {
      return contextFrom(this);
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
    req.auth = await opts.authenticator.authenticate(req);
    if (!req.auth && !req.routeOptions.config?.public && req.routeOptions.url) {
      const { UnauthenticatedError } = await import('@portico/kernel');
      throw new UnauthenticatedError();
    }
  });

  app.get('/health/live', { config: { public: true }, schema: { hide: true } }, async () => ({
    status: 'ok',
  }));
  app.get('/health/ready', { config: { public: true }, schema: { hide: true } }, async () => {
    await opts.readiness?.();
    return { status: 'ready' };
  });
  app.get('/v1/openapi.json', { config: { public: true }, schema: { hide: true } }, async () =>
    app.swagger(),
  );

  await app.register(
    async (v1) => {
      for (const m of opts.modules) await m.routes(v1 as PorticoApp);
    },
    { prefix: '/v1' },
  );

  return app;
}
