import { cn, Kbd } from '@portico/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '../../config';
import { RecordLink } from '../../records/entity-link';
import { pinnedRecords, useRecordRefs } from '../../records/stores';
import { useApp } from '../app-context';
import { type Workspace, workspaceOf } from '../workspaces';
import { NAV_ICONS, WORKSPACE_ICONS } from './nav-icons';

/** Icon rail of workspaces (two-level navigation, design direction). */
export function WorkspaceRail({
  workspaces,
  active,
}: {
  workspaces: readonly Workspace[];
  active: string | null;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.workspaces')}
      className="flex h-full w-[5.75rem] flex-col items-center gap-1 border-e border-line bg-surface-muted py-3"
    >
      <span
        aria-hidden
        className="mb-2 inline-flex size-8 items-center justify-center rounded-md bg-accent text-sm font-bold text-on-accent"
      >
        {PRODUCT_NAME.charAt(0)}
      </span>
      <ul className="flex flex-col gap-1">
        {workspaces.map((w) => {
          const Icon = WORKSPACE_ICONS[w.id];
          const first = w.items[0];
          if (!first) return null;
          const current = active === w.id;
          return (
            <li key={w.id}>
              <Link
                to={first.to}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'flex w-[5.25rem] flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 text-[0.625rem] font-medium text-ink-muted hover:bg-surface-hover hover:text-ink',
                  current && 'bg-surface text-accent shadow-[inset_0_0_0_1px_var(--pt-line)]',
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className="w-full text-center leading-tight [overflow-wrap:break-word]">
                  {t(w.labelKey)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Section list of the active workspace + pinned records. */
export function SectionList({
  workspace,
  onNavigate,
  showPinned = true,
}: {
  workspace: Workspace | undefined;
  onNavigate?: () => void;
  showPinned?: boolean;
}) {
  const { t } = useTranslation();
  const { me } = useApp();
  const pinned = useRecordRefs(pinnedRecords, me.userId);
  return (
    <nav
      aria-label={workspace ? t(workspace.labelKey) : t('app.mainNav')}
      className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4"
    >
      {workspace && (
        <div className="flex flex-col gap-0.5">
          <h2 className="px-2 pb-1 text-sm font-semibold">{t(workspace.labelKey)}</h2>
          <ul className="flex flex-col gap-0.5">
            {workspace.items.map((item) => {
              const Icon = NAV_ICONS[item.to];
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    activeProps={{ 'aria-current': 'page' }}
                    className="flex min-h-control items-center gap-2.5 rounded-md px-2 text-sm text-ink hover:bg-surface-hover data-[status=active]:bg-accent-soft data-[status=active]:font-semibold data-[status=active]:text-accent"
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    {item.goKey && (
                      <span className="hidden gap-0.5 lg:inline-flex">
                        <Kbd>G</Kbd>
                        <Kbd>{item.goKey.toUpperCase()}</Kbd>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {showPinned && pinned.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-1 px-2 text-xs font-semibold text-ink-muted">
            <Pin aria-hidden className="size-3.5" /> {t('nav.pinned')}
          </h2>
          <ul className="flex flex-col gap-1 px-2 text-sm">
            {pinned.map((p) => (
              <li key={`${p.type}:${p.id}`} className="truncate">
                <RecordLink type={p.type} id={p.id} fresh>
                  {p.title}
                </RecordLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

export function useActiveWorkspace(workspaces: readonly Workspace[]) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const id = workspaceOf(pathname);
  return workspaces.find((w) => w.id === id) ?? workspaces[0];
}

/**
 * Mid widths (and whenever the side list is hidden): the active workspace's sections as tabs above the page
 * (UX round 1, C2.1). Shown only when the workspace has two or more sections.
 */
export function SectionTabs({
  workspace,
  className,
}: {
  workspace: Workspace | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!workspace || workspace.items.length < 2) return null;
  return (
    <nav aria-label={t(workspace.labelKey)} className={cn('-mt-1 mb-3 overflow-x-auto', className)}>
      <ul className="flex gap-1 border-b border-line">
        {workspace.items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeProps={{ 'aria-current': 'page' }}
              className="inline-flex min-h-10 items-center whitespace-nowrap border-b-2 border-transparent px-3 text-sm text-ink-muted hover:text-ink data-[status=active]:border-accent data-[status=active]:font-semibold data-[status=active]:text-ink"
            >
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
