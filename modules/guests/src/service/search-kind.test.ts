import { describe, expect, it } from 'vitest';
import { detectQueryKind } from './search';

describe('search query kind (UX NAV-03, integration-step review P3-6)', () => {
  it('phone fragments need a leading + or 4+ digits; a room number stays a name search', () => {
    expect(detectQueryKind('7712')).toBe('phone');
    expect(detectQueryKind('+960')).toBe('phone');
    expect(detectQueryKind('+960 771 2345')).toBe('phone');
    expect(detectQueryKind('214')).toBe('name');
    expect(detectQueryKind('Kowal')).toBe('name');
  });
});
