import { BusinessRuleError, NotFoundError, VersionConflictError } from '@portico/kernel';
import { describe, expect, it } from 'vitest';
import { toProblem } from '../src';

describe('problem details', () => {
  it('maps domain errors to RFC 9457 with stable codes and recovery guidance', () => {
    const p = toProblem(new VersionConflictError('stay', 's1', 3, 4), 'req-1');
    expect(p).toMatchObject({
      status: 409,
      code: 'version_conflict',
      correlationId: 'req-1',
      retryable: false,
    });
    expect(p.detail).toMatch(/Review the latest version/);
    expect(toProblem(new NotFoundError('booking', 'b1'), 'r').status).toBe(404);
    expect(
      toProblem(new BusinessRuleError('unit_not_ready', 'Room 204 is not inspected yet.'), 'r'),
    ).toMatchObject({ status: 422, code: 'unit_not_ready' });
  });

  it('never leaks internals for unexpected errors', () => {
    const p = toProblem(new Error('connection string postgres://secret@db'), 'req-9');
    expect(p.status).toBe(500);
    expect(p.detail).not.toContain('postgres://');
    expect(p.detail).toContain('req-9');
  });
});
