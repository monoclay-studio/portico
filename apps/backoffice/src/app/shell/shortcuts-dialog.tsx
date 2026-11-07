import { Dialog, Kbd } from '@portico/ui';
import { useTranslation } from 'react-i18next';
import { SHORTCUTS, type ShortcutDef } from '../shortcuts';

/** The ? overlay renders the one shortcut registry, grouped. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const groups: ShortcutDef['group'][] = ['global', 'goTo', 'record', 'lists'];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t('shortcuts.title')} description={t('shortcuts.description')}>
      <div className="grid gap-6 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g} aria-labelledby={`sc-${g}`}>
            <h3 id={`sc-${g}`} className="mb-1 text-sm font-semibold">
              {t(`shortcuts.groups.${g}`)}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-b-0" data-shortcut={s.id}>
                    <td className="py-1.5 pe-3">{t(s.labelKey)}</td>
                    <td className="py-1.5 text-end whitespace-nowrap">
                      <span className="inline-flex gap-1">
                        {s.display.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
