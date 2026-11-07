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

/** Problem for failures that never reached the server (offline, DNS, CORS). */
export function networkProblem(correlationId: string, detail: string): ProblemDetails {
  return {
    type: 'about:blank#network',
    title: 'Connection problem',
    status: 0,
    code: 'network_error',
    detail,
    retryable: true,
    correlationId,
  };
}
