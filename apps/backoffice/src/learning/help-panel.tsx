import { Button, Drawer, Kbd } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { BookOpen, GraduationCap, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SHORTCUTS } from '../app/shortcuts';
import { resolveHelp } from './help-map';

/** Contextual help for a help anchor: website article/video when published, otherwise an honest placeholder. */
export function HelpPanel({ helpKey, onClose }: { helpKey: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!helpKey) return null;
  const link = resolveHelp(helpKey);
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={t('help.forScreen')} description={undefined}>
      <div className="flex flex-col gap-4 text-sm" data-help-panel={helpKey}>
        <p className="flex items-center gap-2">
          <span className="text-ink-muted">{t('help.anchor')}:</span>
          <span className="pt-data text-ink normal-case">{helpKey}</span>
        </p>
        {link ? (
          <div className="flex flex-col gap-2">
            {link.article && (
              <a
                className="inline-flex items-center gap-2 font-medium text-accent underline"
                href={link.article}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen aria-hidden className="size-4" /> {t('help.article')}
              </a>
            )}
            {link.video && (
              <a
                className="inline-flex items-center gap-2 font-medium text-accent underline"
                href={link.video}
                target="_blank"
                rel="noreferrer"
              >
                <PlayCircle aria-hidden className="size-4" /> {t('help.video')}
              </a>
            )}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-line-strong p-3 text-ink-muted">
            {t('help.comingSoon')}
          </p>
        )}
        <Button asChild variant="secondary" icon={<GraduationCap />}>
          <Link to="/learn" onClick={onClose}>
            {t('help.learningCentre')}
          </Link>
        </Button>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('help.shortcutsHere')}</h3>
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.filter((s) => s.group === 'global').map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>{t(s.labelKey)}</span>
                <span className="inline-flex gap-1">
                  {s.display.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}
