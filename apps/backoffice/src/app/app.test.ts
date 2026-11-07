import { defaultUiStrings } from '@portico/ui';
import { describe, expect, it } from 'vitest';
import { ar } from '../i18n/ar';
import { en } from '../i18n/en';
import { HELP_LINKS, resolveHelp } from '../learning/help-map';
import { checklistFor, LEARNING_PATHS, pathsFor } from '../learning/paths';
import { RECORD_TYPES } from '../records/registry';
import { formatTrail, parseTrail, pushTrail } from '../records/trail';
import { SHORTCUTS } from './shortcuts';
import { canOpen, helpKeyFor, homeFor, WORKSPACES, workspacesFor } from './workspaces';

const role = (key: string) => ({ roles: [{ key, name: key, scopeType: 'property', scopeId: null }] });

describe('role workspaces', () => {
  it('shows each role only what it needs (progressive disclosure)', () => {
    expect(workspacesFor(role('front_desk')).map((w) => w.id)).toEqual([
      'overview',
      'frontDesk',
      'reservations',
      'housekeeping',
    ]);
    expect(workspacesFor(role('housekeeping_attendant')).map((w) => w.id)).toEqual([
      'overview',
      'housekeeping',
    ]);
    expect(canOpen(role('housekeeping_attendant'), '/settings/users')).toBe(false);
    expect(canOpen(role('org_admin'), '/settings/users')).toBe(true);
  });
  it('lands each role on its working surface', () => {
    expect(homeFor(role('front_desk'))).toBe('/front-desk/arrivals');
    expect(homeFor(role('housekeeping_supervisor'))).toBe('/housekeeping');
    expect(homeFor(role('reservations_agent'))).toBe('/reservations/timeline');
    expect(homeFor(role('org_admin'))).toBe('/today');
  });
});

describe('one keyboard map', () => {
  it('has no duplicate bindings and includes the universal verbs', () => {
    const combos = SHORTCUTS.map((s) => s.combo).filter(Boolean);
    expect(new Set(combos).size).toBe(combos.length);
    for (const c of ['mod+k', '/', '?', 'n', 'e', 'g a', 'g t', 'g h']) expect(combos).toContain(c);
  });
});

describe('learning layer', () => {
  it('every screen has a stable helpKey <module>.<screen>[.<element>]', () => {
    for (const w of WORKSPACES)
      for (const i of w.items) expect(i.helpKey).toMatch(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/);
    expect(helpKeyFor('/front-desk/arrivals')).toBe('frontDesk.arrivals');
  });
  it('resolves help with parent fallback and stays empty until the website publishes', () => {
    expect(Object.keys(HELP_LINKS)).toHaveLength(0);
    expect(
      resolveHelp('frontDesk.arrivals.board', { frontDesk: { article: 'https://example.invalid/a' } }),
    ).toEqual({ article: 'https://example.invalid/a' });
    expect(resolveHelp('x.y')).toBeNull();
  });
  it('offers role learning paths and a first-run checklist per role', () => {
    expect(LEARNING_PATHS.map((p) => p.id)).toEqual([
      'frontDesk',
      'reservations',
      'housekeeping',
      'nightAudit',
      'finance',
      'revenue',
      'manager',
      'guesthouse',
    ]);
    expect(pathsFor(['front_desk'], 'resort').recommended.map((p) => p.id)).toEqual(['frontDesk']);
    expect(pathsFor(['org_admin'], 'guesthouse').recommended.map((p) => p.id)).toContain('guesthouse');
    expect(checklistFor(['front_desk'])?.items.length).toBeGreaterThan(3);
    const paths = new Set(WORKSPACES.flatMap((w) => w.items.map((i) => i.to)));
    for (const p of LEARNING_PATHS) for (const l of p.lessons) if (l.to) expect(paths.has(l.to)).toBe(true);
  });
});

describe('record drawer trail', () => {
  it('round-trips through the URL and jumps back instead of duplicating', () => {
    const trail = parseTrail('stay:s1,unit:u1');
    expect(trail).toEqual([
      { type: 'stay', id: 's1' },
      { type: 'unit', id: 'u1' },
    ]);
    expect(formatTrail(trail)).toBe('stay:s1,unit:u1');
    expect(pushTrail(trail, { type: 'stay', id: 's1' })).toEqual([{ type: 'stay', id: 's1' }]);
    expect(formatTrail([])).toBeUndefined();
    expect(parseTrail('garbage')).toEqual([]);
  });
  it('registers real and simulated record types', () => {
    expect(Object.keys(RECORD_TYPES).sort()).toEqual([
      'guest',
      'legal_entity',
      'property',
      'stay',
      'unit',
      'user',
    ]);
    expect(RECORD_TYPES.property?.simulated).toBe(false);
    expect(RECORD_TYPES.stay?.simulated).toBe(true);
  });
});

function keysOf(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object') return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n', () => {
  it('the RTL stub only translates keys that exist in English', () => {
    const enKeys = new Set(keysOf(en));
    for (const k of keysOf(ar)) expect(enKeys.has(k), k).toBe(true);
  });
  it('ships every design-system string', () => {
    expect(keysOf(en.ui).sort()).toEqual(keysOf(defaultUiStrings).sort());
  });
});
