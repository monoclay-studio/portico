/**
 * RFC 9457 problem details as produced by @portico/http (`toProblem`). Kept structural (no server import) so the
 * design system can render problems from any Portico API.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  /** What happened AND how to recover — written by the server for humans. */
  detail: string;
  retryable: boolean;
  correlationId: string;
  errors?: Array<{ path: string; message: string }>;
  details?: Record<string, unknown>;
  /**
   * Client hint: whether repeating THIS request is known to be safe (a read, or a write carrying an
   * Idempotency-Key). Undefined = the UI makes no promise.
   */
  safeToRetry?: boolean;
  /** Why repeating is safe: a read, or a write carrying an Idempotency-Key. */
  retryBasis?: 'read' | 'idempotency_key';
  /** Client hint: the request may or may not have taken effect (connection lost after sending, timeout). */
  outcome?: 'unknown';
  [key: string]: unknown;
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.status === 'number' &&
    typeof v.code === 'string' &&
    typeof v.detail === 'string' &&
    typeof v.title === 'string'
  );
}

/** Problem for a request whose outcome the client cannot know (connection lost, timeout). */
export function networkProblem(
  correlationId: string,
  detail: string,
  opts: {
    code?: string;
    title?: string;
    safeToRetry?: boolean;
    retryBasis?: 'read' | 'idempotency_key';
    outcomeUnknown?: boolean;
  } = {},
): ProblemDetails {
  return {
    type: 'about:blank#network',
    title: opts.title ?? 'Connection problem',
    status: 0,
    code: opts.code ?? 'network_error',
    detail,
    retryable: Boolean(opts.safeToRetry),
    correlationId,
    ...(opts.safeToRetry !== undefined ? { safeToRetry: opts.safeToRetry } : {}),
    ...(opts.retryBasis ? { retryBasis: opts.retryBasis } : {}),
    ...(opts.outcomeUnknown ? { outcome: 'unknown' as const } : {}),
  };
}
