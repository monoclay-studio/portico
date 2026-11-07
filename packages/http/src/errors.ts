import { DomainError } from '@portico/kernel';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

/** RFC 9457 problem details. `code` is stable and machine-readable; `detail` explains problem + recovery. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  retryable: boolean;
  correlationId: string;
  errors?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Invalid request',
  401: 'Sign-in required',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  422: 'Cannot complete this action',
  429: 'Too many requests',
  500: 'Unexpected error',
  502: 'External service problem',
  503: 'Temporarily unavailable',
};

export function toProblem(err: unknown, correlationId: string): Problem {
  if (err instanceof DomainError) {
    return {
      type: `https://docs.portico.app/errors/${err.code}`,
      title: TITLES[err.status] ?? 'Error',
      status: err.status,
      code: err.code,
      detail: err.message,
      retryable: err.retryable,
      correlationId,
      ...(err.details ? { details: err.details } : {}),
    };
  }
  const fe = err as FastifyError & { validation?: unknown };
  if (hasZodFastifySchemaValidationErrors(fe)) {
    return {
      type: 'https://docs.portico.app/errors/validation_failed',
      title: TITLES[400] as string,
      status: 400,
      code: 'validation_failed',
      detail: 'Some fields are missing or invalid. Correct the highlighted fields and try again.',
      retryable: false,
      correlationId,
      errors: fe.validation.map((v) => ({ path: v.instancePath || '/', message: v.message ?? 'invalid' })),
    };
  }
  if (fe.statusCode === 429) {
    return {
      type: 'https://docs.portico.app/errors/rate_limited',
      title: TITLES[429] as string,
      status: 429,
      code: 'rate_limited',
      detail: 'Too many requests in a short time. Wait a few seconds and try again.',
      retryable: true,
      correlationId,
    };
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500 && !isResponseSerializationError(fe)) {
    return {
      type: 'https://docs.portico.app/errors/bad_request',
      title: TITLES[fe.statusCode] ?? 'Invalid request',
      status: fe.statusCode,
      code: fe.code ?? 'bad_request',
      detail: fe.message,
      retryable: false,
      correlationId,
    };
  }
  return {
    type: 'https://docs.portico.app/errors/internal',
    title: TITLES[500] as string,
    status: 500,
    code: 'internal_error',
    detail: `Something went wrong on our side and nothing was changed by this request unless stated otherwise. Quote reference ${correlationId} to support.`,
    retryable: true,
    correlationId,
  };
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem = toProblem(err, String(req.id));
  if (problem.status >= 500) req.log.error({ err }, 'request failed');
  else req.log.info({ code: problem.code, status: problem.status }, 'request rejected');
  return reply.status(problem.status).type('application/problem+json').send(problem);
}
