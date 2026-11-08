/**
 * R-P1-4: the verdict the importer, the rehearsal and the cutover gate share. Decided records never hold the cutover;
 * a decision covers exactly the problem it was made for.
 */
import { describe, expect, it } from 'vitest';
import type { Problem } from '../domain/records';
import { type ExceptionDecision, importability } from './state';

const blocking = (code: string): Problem => ({ code, severity: 'blocking', message: code });
const warning = (code: string): Problem => ({ code, severity: 'warning', message: code });
const decided = (entries: Record<string, ExceptionDecision['outcome']>) =>
  new Map(
    Object.entries(entries).map(([code, outcome]) => [
      code,
      { status: 'resolved', outcome, severity: 'blocking' },
    ]),
  );
const verdict = (problems: Problem[], d?: Map<string, ExceptionDecision>, payload: unknown = {}) =>
  importability({ problems, payload }, d);

describe('importability (R-P1-4)', () => {
  it('no blocking problem → import (warnings never hold a record)', () => {
    expect(verdict([warning('possible_duplicate_profile')])).toMatchObject({ verdict: 'import' });
  });

  it('an undecided blocking problem → exception, and it holds the cutover', () => {
    expect(verdict([blocking('future_stay_in_past')])).toMatchObject({
      verdict: 'exception',
      deferred: false,
    });
  });

  it('excluded or accepted as loss → excluded (decided: never holds the cutover)', () => {
    expect(
      verdict([blocking('future_stay_in_past')], decided({ future_stay_in_past: 'excluded' })),
    ).toMatchObject({
      verdict: 'excluded',
    });
    expect(
      verdict([blocking('amount_invalid')], decided({ amount_invalid: 'accepted_as_loss' })),
    ).toMatchObject({
      verdict: 'excluded',
    });
  });

  it('import as is only where allowed', () => {
    expect(
      verdict([blocking('prepaid_without_deposit')], decided({ prepaid_without_deposit: 'import_as_is' })),
    ).toMatchObject({ verdict: 'import' });
    expect(verdict([blocking('amount_invalid')], decided({ amount_invalid: 'import_as_is' }))).toMatchObject({
      verdict: 'exception',
    });
  });

  it('deferred → not imported now, but decided (does not hold the cutover)', () => {
    expect(
      verdict([blocking('unit_double_assigned')], decided({ unit_double_assigned: 'deferred' })),
    ).toMatchObject({
      verdict: 'exception',
      deferred: true,
    });
  });

  it('a problem that appears after the decision holds the record again (decisions are per problem)', () => {
    const d = decided({ future_stay_in_past: 'excluded' });
    expect(verdict([blocking('future_stay_in_past'), blocking('amount_invalid')], d)).toMatchObject({
      verdict: 'exception',
      deferred: false,
    });
    const asIs = decided({ prepaid_without_deposit: 'import_as_is' });
    expect(
      verdict([blocking('prepaid_without_deposit'), blocking('unit_double_assigned')], asIs),
    ).toMatchObject({
      verdict: 'exception',
    });
  });

  it('a decided problem that disappeared no longer applies (the record is judged on its current problems)', () => {
    expect(verdict([], decided({ future_stay_in_past: 'excluded' }))).toMatchObject({ verdict: 'import' });
  });

  it('an unreadable row is excluded or deferred only by decision', () => {
    expect(verdict([], undefined, null)).toMatchObject({ verdict: 'exception', deferred: false });
    expect(verdict([], decided({ unreadable_row: 'excluded' }), null)).toMatchObject({ verdict: 'excluded' });
    expect(verdict([], decided({ unreadable_row: 'deferred' }), null)).toMatchObject({ deferred: true });
    // a decision on another code never covers the problem that made the row unreadable
    expect(
      verdict([blocking('amount_invalid')], decided({ future_stay_in_past: 'excluded' }), null),
    ).toMatchObject({
      verdict: 'exception',
      deferred: false,
    });
    expect(
      verdict([blocking('amount_invalid')], decided({ amount_invalid: 'excluded' }), null),
    ).toMatchObject({
      verdict: 'excluded',
    });
  });
});
