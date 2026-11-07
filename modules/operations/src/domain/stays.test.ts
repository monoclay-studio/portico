import { describe, expect, it } from 'vitest';
import { nextStayStatus } from './stays';

describe('stay projection status (order-tolerant)', () => {
  it('moves forward with unordered events', () => {
    expect(nextStayStatus(null, 'expected', false)).toBe('expected');
    expect(nextStayStatus('expected', 'in_house', false)).toBe('in_house');
    expect(nextStayStatus('in_house', 'departed', false)).toBe('departed');
    expect(nextStayStatus('expected', 'cancelled', false)).toBe('cancelled');
  });
  it('never regresses on a late or status-less event', () => {
    expect(nextStayStatus('departed', 'in_house', false)).toBe('departed'); // late checkedIn
    expect(nextStayStatus('in_house', 'expected', false)).toBe('in_house'); // booking modified
    expect(nextStayStatus('in_house', undefined, false)).toBe('in_house');
    expect(nextStayStatus('cancelled', 'expected', false)).toBe('cancelled');
  });
  it('a provably newer event (aggregateVersion) is authoritative, e.g. reinstatement', () => {
    expect(nextStayStatus('departed', 'in_house', true)).toBe('in_house');
    expect(nextStayStatus('cancelled', 'expected', true)).toBe('expected');
  });
});
