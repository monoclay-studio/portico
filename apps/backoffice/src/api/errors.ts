import { isProblemDetails, networkProblem, type ProblemDetails } from '@portico/ui';

/** Any failed API call. Always carries an RFC 9457 problem so the UI can explain it (ProblemAlert). */
export class ApiError extends Error {
  readonly problem: ProblemDetails;
  constructor(problem: ProblemDetails) {
    super(`${problem.code}: ${problem.detail}`);
    this.name = 'ApiError';
    this.problem = problem;
  }
  get status(): number {
    return this.problem.status;
  }
  get code(): string {
    return this.problem.code;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/**
 * Any thrown value as a problem for ProblemAlert. Screen-side failures never show raw exception text to staff
 * (it goes to `details` for support); the reference is marked as client-side so it is not offered as a server id.
 */
export function problemFromUnknown(e: unknown, where: string): ProblemDetails {
  if (e instanceof ApiError) return e.problem;
  if (isProblemDetails(e)) return e;
  return {
    type: 'about:blank#client',
    title: 'This screen ran into a problem',
    status: 0,
    code: 'client_error',
    detail:
      'Part of this screen stopped working. Try again; if it happens again, reload this screen. If you were changing a record, check it before repeating the change.',
    retryable: true,
    correlationId: `client:${where}`,
    details: { message: e instanceof Error ? e.message : String(e) },
  };
}

export type RequestKind = 'read' | 'write';

/**
 * The connection failed (or timed out) before an answer arrived. For a read nothing changed and repeating is
 * safe. For a write the server may or may not have applied it, so it is shown as pending verification —
 * never as "nothing was sent" — and a blind retry is offered only when an Idempotency-Key makes it harmless.
 */
export function connectionProblem(
  correlationId: string,
  opts: { kind: RequestKind; timedOut: boolean; idempotent: boolean; timeoutMs?: number },
): ProblemDetails {
  const seconds = opts.timeoutMs ? Math.round(opts.timeoutMs / 1000) : null;
  if (opts.kind === 'read') {
    return networkProblem(
      correlationId,
      opts.timedOut
        ? `Portico did not answer within ${seconds ?? 'a few'} seconds. Nothing was changed. Try again; if it keeps happening, check the connection.`
        : 'Portico could not be reached. Nothing was changed. Check the connection, then try again.',
      {
        code: opts.timedOut ? 'request_timeout' : 'network_error',
        title: opts.timedOut ? 'Portico is taking too long to answer' : 'Portico could not be reached',
        safeToRetry: true,
        retryBasis: 'read',
      },
    );
  }
  return networkProblem(
    correlationId,
    `${opts.timedOut ? 'Portico did not answer in time' : 'The connection was lost'}, so we could not confirm whether this was saved. ${
      opts.idempotent
        ? 'Trying again is safe — it cannot be applied twice — or open the record to check first.'
        : 'Open the record to check before trying again, so it is not done twice.'
    }`,
    {
      code: opts.timedOut ? 'request_timeout' : 'network_error',
      title: 'Not confirmed — pending verification',
      outcomeUnknown: true,
      safeToRetry: opts.idempotent,
      ...(opts.idempotent ? { retryBasis: 'idempotency_key' as const } : {}),
    },
  );
}

/** The server answered with a shape this build does not understand (deploy skew or a contract change). */
export function contractProblem(correlationId: string, path: string, issues: string): ProblemDetails {
  return {
    type: 'about:blank#contract',
    title: 'Portico answered in an unexpected format',
    status: 0,
    code: 'contract_mismatch',
    detail:
      'This screen did not recognise the answer, so nothing was shown or assumed. Reload to get the latest version of Portico; if it persists, quote the reference to support.',
    retryable: false,
    correlationId,
    details: { path, issues },
  };
}
