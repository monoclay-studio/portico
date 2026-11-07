import {
  cn,
  Drawer,
  EnvironmentBanner,
  IconButton,
  isApplePlatform,
  Kbd,
  OfflineIndicator,
  ProblemAlert,
  SkeletonList,
  useHotkey,
  useOnlineStatus,
} from '@portico/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { Menu, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { connectivity, useApiReachable } from '../../api/connectivity';
import { problemFromUnknown } from '../../api/errors';
import { queries } from '../../api/queries';
import { sessionStore, useSession } from '../../api/session';
import { AppContext, type AppContextValue, rememberedPropertyId, rememberPropertyId } from '../app-context';
import { workspacesFor } from '../workspaces';
import { GlobalPalette } from './global-palette';
import { PropertySwitcher } from './property-switcher';
import { ShortcutsDialog } from './shortcuts-dialog';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';

/** Signed-in layout: environment banner, role-workspace navigation, property switcher, search, palette. */
export function AppShell() {
  const { t } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgId = session?.organization.id ?? 'none';
  const me = useQuery({ ...queries.me(orgId), enabled: Boolean(session) });
  const organization = useQuery({ ...queries.organization(orgId), enabled: Boolean(session) });
  const properties = useQuery({ ...queries.properties(orgId), enabled: Boolean(session) });
  const [selectedId, setSelectedId] = useState<string | null>(() => rememberedPropertyId(orgId));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const apiReachable = useApiReachable();
  const online = useOnlineStatus();

  useEffect(() => {
    if (!session) void navigate({ to: '/sign-in', search: { reason: sessionStore.endedReason ?? undefined } });
  }, [session, navigate]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session is dropped locally regardless; the server session expires on its own.
    }
    sessionStore.clear('signed_out');
    queryClient.clear();
  }, [queryClient]);

  const props = properties.data ?? [];
  const property = props.find((p) => p.id === selectedId) ?? props[0] ?? null;
  const setPropertyId = useCallback(
    (id: string) => {
      setSelectedId(id);
      rememberPropertyId(orgId, id);
    },
    [orgId],
  );

  useHotkey('mod+k', () => setPaletteOpen((o) => !o));
  useHotkey('/', () => setPaletteOpen(true));
  useHotkey('?', () => setShortcutsOpen(true));
  useHotkey('g a', () => void navigate({ to: '/front-desk/arrivals' }));
  useHotkey('g h', () => void navigate({ to: '/housekeeping' }));
  useHotkey('g t', () => void navigate({ to: '/reservations/timeline' }));
  useHotkey('g u', () => void navigate({ to: '/admin/users' }));
  useHotkey('g p', () => setSwitcherOpen(true));

  const value = useMemo<AppContextValue | null>(() => {
    if (!session || !me.data || !organization.data) return null;
    return {
      session,
      me: me.data,
      organization: organization.data,
      properties: props,
      property,
      setPropertyId,
      workspaces: workspacesFor(me.data),
      openPalette: () => setPaletteOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
    };
  }, [session, me.data, organization.data, props, property, setPropertyId]);

  if (!session) return null;
  const environment = organization.data?.environment ?? session.organization.environment;
  const failure = me.error ?? organization.error ?? properties.error;
  const mod = isApplePlatform() ? '⌘' : 'Ctrl';

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="pt-sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-surface focus:p-2 focus:shadow-lg"
      >
        {t('app.skipToContent')}
      </a>
      <EnvironmentBanner environment={environment} organizationName={session.organization.name} />
      {!value ? (
        <main id="main" className="mx-auto w-full max-w-3xl p-6" aria-busy={!failure}>
          {failure ? (
            <ProblemAlert
              problem={problemFromUnknown(failure, 'app-shell')}
              onRetry={() => {
                void me.refetch();
                void organization.refetch();
                void properties.refetch();
              }}
            />
          ) : (
            <SkeletonList rows={6} label={t('app.loadingWorkspace')} />
          )}
        </main>
      ) : (
        <AppContext.Provider value={value}>
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-60 shrink-0 border-e border-line bg-surface md:block lg:w-64">
              <div className="sticky top-0 h-dvh">
                <Sidebar workspaces={value.workspaces} />
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4">
                <div className="md:hidden">
                  <IconButton label={t('app.mainNav')} icon={<Menu />} onClick={() => setNavOpen(true)} />
                </div>
                <div className="min-w-0 flex-1 sm:flex-none">
                  <PropertySwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
                </div>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-keyshortcuts={isApplePlatform() ? 'Meta+K' : 'Control+K'}
                  className="ms-auto hidden min-h-control w-72 items-center gap-2 rounded-md border border-line-strong bg-surface-muted px-3 text-sm text-ink-muted hover:bg-surface-hover sm:flex lg:w-96"
                >
                  <Search aria-hidden className="size-4" />
                  <span className="flex-1 text-start">{t('app.searchPlaceholder')}</span>
                  <Kbd>{mod}</Kbd>
                  <Kbd>K</Kbd>
                </button>
                <div className="sm:hidden">
                  <IconButton label={t('app.search')} icon={<Search />} onClick={() => setPaletteOpen(true)} />
                </div>
                <UserMenu onSignOut={() => void signOut()} />
              </header>
              <div className={cn(!(online && apiReachable) && 'px-3 pt-2 sm:px-4')}>
                <OfflineIndicator
                  online={online}
                  apiReachable={apiReachable}
                  lastUpdatedAt={connectivity.lastSuccessAt ?? undefined}
                  timeZone={property?.timezone ?? 'UTC'}
                />
              </div>
              <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 outline-none sm:px-6 sm:py-5">
                <Outlet />
              </main>
            </div>
          </div>
          <Drawer open={navOpen} onOpenChange={setNavOpen} title={t('app.mainNav')}>
            <Sidebar workspaces={value.workspaces} onNavigate={() => setNavOpen(false)} />
          </Drawer>
          <GlobalPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSignOut={() => void signOut()} />
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </AppContext.Provider>
      )}
    </div>
  );
}
