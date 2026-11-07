import { Dialog, isApplePlatform, Kbd } from '@portico/ui';
import { useTranslation } from 'react-i18next';

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const mod = isApplePlatform() ? '⌘' : 'Ctrl';
  const rows: Array<[string[], string]> = [
    [[mod, 'K'], t('shortcuts.palette')],
    [['/'], t('shortcuts.search')],
    [['?'], t('shortcuts.help')],
    [['G', 'A'], t('shortcuts.goArrivals')],
    [['G', 'H'], t('shortcuts.goHousekeeping')],
    [['G', 'T'], t('shortcuts.goTimeline')],
    [['G', 'U'], t('shortcuts.goUsers')],
    [['G', 'P'], t('shortcuts.switchProperty')],
    [['↑', '↓', '←', '→', 'Enter'], t('shortcuts.tableNav')],
    [['Esc'], t('shortcuts.closeDialog')],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('shortcuts.title')} description={t('shortcuts.description')}>
      <table className="w-full text-sm">
        <caption className="pt-sr-only">{t('shortcuts.title')}</caption>
        <thead className="pt-sr-only">
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={label} className="border-b border-line last:border-b-0">
              <td className="py-2 pe-4 whitespace-nowrap">
                <span className="inline-flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </td>
              <td className="py-2">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
