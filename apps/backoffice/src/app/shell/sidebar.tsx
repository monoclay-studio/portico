import { cn, Kbd } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '../../config';
import type { Workspace } from '../workspaces';
import { NAV_ICONS } from './nav-icons';

export function Sidebar({ workspaces, onNavigate }: { workspaces: readonly Workspace[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('app.mainNav')} className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-on-accent">
          {PRODUCT_NAME.charAt(0)}
        </span>
        <span className="text-base font-semibold tracking-tight">{PRODUCT_NAME}</span>
      </div>
      {workspaces.map((w) => (
        <div key={w.id} className="flex flex-col gap-0.5">
          <h2 className="px-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-muted">{t(w.labelKey)}</h2>
          <ul className="flex flex-col gap-0.5">
            {w.items.map((item) => {
              const Icon = NAV_ICONS[item.to];
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    className={cn(
                      'flex min-h-control items-center gap-2.5 rounded-md px-2 text-sm text-ink hover:bg-surface-hover',
                      'data-[status=active]:bg-accent-soft data-[status=active]:font-semibold data-[status=active]:text-accent',
                    )}
                    activeProps={{ 'aria-current': 'page' }}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    {item.shortcut && (
                      <span className="hidden lg:inline-flex">
                        <Kbd>{item.shortcut}</Kbd>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
