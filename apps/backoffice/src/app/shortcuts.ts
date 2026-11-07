import { isApplePlatform } from '@portico/ui';
import { WORKSPACES } from './workspaces';

/**
 * THE keyboard map (experience architecture §2: same verbs, same keys in every module). Every binding the app
 * registers comes from this list, and the ? overlay renders it — so the overlay can never drift from reality.
 */
export interface ShortcutDef {
  id: string;
  /** useHotkey combo, e.g. 'mod+k', '/', 'g a'. */
  combo: string;
  display: string[];
  labelKey: string;
  group: 'global' | 'goTo' | 'record' | 'lists';
}

const mod = () => (isApplePlatform() ? '⌘' : 'Ctrl');

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'palette', combo: 'mod+k', display: [mod(), 'K'], labelKey: 'shortcuts.palette', group: 'global' },
  { id: 'search', combo: '/', display: ['/'], labelKey: 'shortcuts.search', group: 'global' },
  { id: 'help', combo: '?', display: ['?'], labelKey: 'shortcuts.help', group: 'global' },
  { id: 'new', combo: 'n', display: ['N'], labelKey: 'shortcuts.new', group: 'global' },
  { id: 'edit', combo: 'e', display: ['E'], labelKey: 'shortcuts.edit', group: 'record' },
  {
    id: 'fullPage',
    combo: 'shift+enter',
    display: ['Shift', 'Enter'],
    labelKey: 'shortcuts.fullPage',
    group: 'record',
  },
  { id: 'back', combo: 'escape', display: ['Esc'], labelKey: 'shortcuts.closeDialog', group: 'record' },
  {
    id: 'switchProperty',
    combo: 'g p',
    display: ['G', 'P'],
    labelKey: 'shortcuts.switchProperty',
    group: 'goTo',
  },
  ...WORKSPACES.flatMap((w) =>
    w.items
      .filter((i) => i.goKey && i.goKey !== 'p')
      .map((i) => ({
        id: `go:${i.to}`,
        combo: `g ${i.goKey}`,
        display: ['G', (i.goKey as string).toUpperCase()],
        labelKey: i.labelKey,
        group: 'goTo' as const,
      })),
  ),
  {
    id: 'tableNav',
    combo: '',
    display: ['↑', '↓', '←', '→', 'Enter'],
    labelKey: 'shortcuts.tableNav',
    group: 'lists',
  },
];
