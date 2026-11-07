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

export function problemFromUnknown(e: unknown, correlationId: string): ProblemDetails {
  if (e instanceof ApiError) return e.problem;
  if (isProblemDetails(e)) return e;
  return {
    type: 'about:blank#client',
    title: 'Something went wrong in this screen',
    status: 0,
    code: 'client_error',
    detail: `${e instanceof Error ? e.message : String(e)}. Reload the page; if it happens again, quote the reference to support.`,
    retryable: false,
    correlationId,
  };
}

export function offlineProblem(correlationId: string): ProblemDetails {
  return networkProblem(
    correlationId,
    'Portico could not be reached, so nothing was sent. Check the connection and try again — retrying is safe.',
  );
}

/** The server answered with a shape this build does not understand (deploy skew or a contract change). */
export function contractProblem(correlationId: string, path: string, issues: string): ProblemDetails {
  return {
    type: 'about:blank#contract',
    title: 'Unexpected answer from the server',
    status: 0,
    code: 'contract_mismatch',
    detail: `The response from ${path} did not match what this screen expects (${issues}). Nothing was assumed. Reload the page to get the latest version; if it persists, quote the reference.`,
    retryable: false,
    correlationId,
  };
}
