/**
 * Domain errors carry a stable machine `code`, an HTTP-ish `status`, a human message that explains the
 * problem AND the recovery, and optional structured `details`. The HTTP layer maps them to RFC 9457.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** Whether the client may safely retry the same request (with the same idempotency key). */
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts: { status?: number; details?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status ?? 422;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

export class ValidationError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, { status: 400, details: details ?? {} });
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(`${entity}_not_found`, id ? `${humanize(entity)} ${id} was not found or you do not have access to it.` : `${humanize(entity)} was not found or you do not have access to it.`, {
      status: 404,
      details: id ? { entity, id } : { entity },
    });
  }
}

/** Business rule prevented the action (e.g. room not ready, sold out). 422. */
export class BusinessRuleError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, { status: 422, details: details ?? {} });
  }
}

/** Optimistic concurrency: someone else changed the record. 409 with current version. */
export class VersionConflictError extends DomainError {
  constructor(entity: string, id: string, expected: number | string, actual: number | string) {
    super(
      'version_conflict',
      `This ${humanize(entity)} was changed by someone else while you were editing. Review the latest version and apply your change again.`,
      { status: 409, details: { entity, id, expectedVersion: expected, currentVersion: actual } },
    );
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, { status: 409, details: details ?? {} });
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'You need to sign in to do this.') {
    super('unauthenticated', message, { status: 401 });
  }
}

export class ForbiddenError extends DomainError {
  constructor(permission: string, scope?: Record<string, unknown>) {
    super('forbidden', `You do not have permission to do this (${permission}). Ask a manager to grant access if you need it.`, {
      status: 403,
      details: { permission, ...(scope ? { scope } : {}) },
    });
  }
}

export class EntitlementError extends DomainError {
  constructor(feature: string) {
    super('feature_not_enabled', `This feature (${feature}) is not part of your organization's plan. An administrator can enable it.`, {
      status: 403,
      details: { feature },
    });
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super('idempotency_conflict', message, { status: 409 });
  }
}

/** The request is still being processed under the same idempotency key. Retry later. */
export class InProgressError extends DomainError {
  constructor() {
    super('request_in_progress', 'An identical request is still being processed. Wait a moment and check the result before trying again.', {
      status: 409,
      retryable: true,
    });
  }
}

/** An external system (payments, channel) failed or is unavailable. */
export class ExternalServiceError extends DomainError {
  constructor(service: string, message: string, opts: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super('external_service_error', message, {
      status: 502,
      retryable: opts.retryable ?? true,
      details: { service, ...(opts.details ?? {}) },
      cause: opts.cause,
    });
  }
}

function humanize(entity: string): string {
  const s = entity.replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
