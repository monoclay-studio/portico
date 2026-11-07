import { EXAMPLE_SECTIONS, UiExamples } from '@portico/ui/examples';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { setTheme, useTheme } from '../../app/theme';
import { PRODUCT_NAME } from '../../config';

/** Public design-system examples page (stories): every component in light/dark and LTR/RTL. */
export function GalleryPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <h1 className="text-lg font-semibold">
          {PRODUCT_NAME} · {t('app.designSystem')}
        </h1>
        <span className="pt-data text-ink-muted">@portico/ui</span>
        <div className="ms-auto flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            {t('app.theme')}
            <select
              className="min-h-control rounded-md border border-line-strong bg-surface px-2"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="system">{t('app.themeSystem')}</option>
              <option value="light">{t('app.themeLight')}</option>
              <option value="dark">{t('app.themeDark')}</option>
            </select>
          </label>
          <Link to="/" className="text-accent underline underline-offset-2">
            {PRODUCT_NAME}
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <nav aria-label={t('app.designSystem')} className="sticky top-20 hidden h-fit w-56 shrink-0 lg:block">
          <ul className="flex flex-col gap-1 text-sm">
            {EXAMPLE_SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1 hover:bg-surface-hover">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1">
          <UiExamples />
        </main>
      </div>
    </div>
  );
}
