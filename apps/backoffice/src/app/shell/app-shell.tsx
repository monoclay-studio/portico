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
  useToast,
} from '@portico/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { CircleHelp, Menu, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { connectivity, useApiReachable } from '../../api/connectivity';
import { problemFromUnknown } from '../../api/errors';
import { queries } from '../../api/queries';
import { sessionStore, useSession } from '../../api/session';
import { HelpContext } from '../../learning/help-context';
import { HelpPanel } from '../../learning/help-panel';
import { learning } from '../../learning/progress';
import { RecordHost } from '../../records/record-host';
import {
  AppContext,
  type AppContextValue,
  rememberedPropertyId,
  rememberPropertyId,
  useApp,
} from '../app-context';
import { density } from '../density';
import { ScreenActionsContext, type ScreenActionsRegistry } from '../screen-actions';
import { SHORTCUTS } from '../shortcuts';
import { helpKeyFor, workspacesFor } from '../workspaces';
import { GlobalPalette } from './global-palette';
import { SectionList, useActiveWorkspace, WorkspaceRail } from './navigation';
import { PropertySwitcher } from './property-switcher';
import { ShortcutsDialog } from './shortcuts-dialog';
import { UserMenu } from './user-menu';

/** Binds every entry of the one shortcut registry (app/shortcuts.ts) to its handler. */
function ShortcutBindings({ run, enabled }: { run: Record<string, () => void>; enabled: boolean }) {
  const navigate = useNavigate();
  for (const s of SHORTCUTS) {
    // biome-ignore lint/correctness/useHookAtTopLevel: SHORTCUTS is a static module constant, so hook order never changes
    useHotkey(
      s.combo || 'unbound',
      () => {
        if (s.id.startsWith('go:')) void navigate({ to: s.id.slice(3) as never });
        else run[s.id]?.();
      },
      { enabled: enabled && Boolean(s.combo) && (s.id.startsWith('go:') || s.id in run) },
    );
  }
  return null;
}

/** Signed-in layout: environment banner, workspace rail + section list, property switcher, search, palette. */
export function AppShell() {
  const { t } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const scope = session ?? { userId: 'none', organization: { id: 'none' } };
  const me = useQuery({ ...queries.me(scope), enabled: Boolean(session) });
  const organization = useQuery({ ...queries.organization(scope), enabled: Boolean(session) });
  const properties = useQuery({ ...queries.properties(scope), enabled: Boolean(session) });
  const [selectedId, setSelectedId] = useState<string | null>(() => rememberedPropertyId(scope));
  const [palette, setPalette] = useState<{ open: boolean; mode: 'search' | 'command' }>({
    open: false,
    mode: 'command',
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [helpKey, setHelpKey] = useState<string | null>(null);
  const apiReachable = useApiReachable();
  const online = useOnlineStatus();
  const screenActions = useRef<ScreenActionsRegistry>({ handlers: new Map() }).current;

  useEffect(() => {
    if (!session) {
      const reason = sessionStore.endedReason ?? undefined;
      // After an expired session, come back to the same screen once signed in again.
      const redirect = reason === 'expired' ? window.location.pathname + window.location.search : undefined;
      void navigate({ to: '/sign-in', search: { reason, ...(redirect ? { redirect } : {}) } });
    }
  }, [session, navigate]);
  useEffect(() => {
    if (me.data) {
      learning.setUser(me.data.userId);
      density.setUser(me.data.userId);
    }
  }, [me.data]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The session is dropped locally regardless; the server session expires on its own.
    }
    sessionStore.clear('signed_out');
    queryClient.clear();
  }, [queryClient]);

  const props = properties.data;
  const property = props?.find((p) => p.id === selectedId) ?? props?.[0] ?? null;
  const setPropertyId = useCallback(
    (id: string) => {
      setSelectedId(id);
      rememberPropertyId(scope, id);
    },
    [scope],
  );
  const openShortcuts = useCallback(() => {
    setShortcutsOpen(true);
    learning.event('shortcuts:open');
  }, []);

  const value = useMemo<AppContextValue | null>(() => {
    if (!session || !me.data || !organization.data || !props) return null;
    return {
      session,
      me: me.data,
      organization: organization.data,
      properties: props,
      property,
      setPropertyId,
      workspaces: workspacesFor(me.data, property?.profile),
      openPalette: () => setPalette({ open: true, mode: 'command' }),
      openShortcuts,
    };
  }, [session, me.data, organization.data, props, property, setPropertyId, openShortcuts]);

  const run: Record<string, () => void> = {
    palette: () => setPalette((p) => ({ open: !p.open, mode: 'command' })),
    search: () => setPalette({ open: true, mode: 'search' }),
    help: openShortcuts,
    new: () => {
      const h = screenActions.handlers.get('new');
      if (h) h();
      else toast({ tone: 'info', title: t('shortcuts.nothingNew') });
    },
    switchProperty: () => setSwitcherOpen(true),
  };

  if (!session) return null;
  const environment = organization.data?.environment ?? session.organization.environment;
  const failure = me.error ?? organization.error ?? properties.error;
  const screenHelp = helpKeyFor(pathname);

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="pt-sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-surface focus:p-2 focus:shadow-lg"
      >
        {t('app.skipToContent')}
      </a>
      <EnvironmentBanner environment={environment} organizationName={session.organization.name} />
      <ShortcutBindings run={run} enabled={Boolean(value)} />
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
          <ScreenActionsContext.Provider value={screenActions}>
            <HelpContext.Provider value={{ openHelp: setHelpKey }}>
              <ShellBody
                online={online}
                apiReachable={apiReachable}
                switcherOpen={switcherOpen}
                setSwitcherOpen={setSwitcherOpen}
                onPalette={() => setPalette({ open: true, mode: 'search' })}
                onNav={() => setNavOpen(true)}
                onHelp={() => setHelpKey(screenHelp ?? 'app.shell')}
                onSignOut={() => void signOut()}
              />
              <NavDrawer open={navOpen} onOpenChange={setNavOpen} />
              <GlobalPalette
                open={palette.open}
                mode={palette.mode}
                onOpenChange={(o) => setPalette((p) => ({ ...p, open: o }))}
                onSignOut={() => void signOut()}
                onShortcuts={openShortcuts}
                onDensity={density.toggle}
              />
              <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
              <HelpPanel helpKey={helpKey} onClose={() => setHelpKey(null)} />
              <RecordHost />
            </HelpContext.Provider>
          </ScreenActionsContext.Provider>
        </AppContext.Provider>
      )}
    </div>
  );
}

function ShellBody(p: {
  online: boolean;
  apiReachable: boolean;
  switcherOpen: boolean;
  setSwitcherOpen: (o: boolean) => void;
  onPalette: () => void;
  onNav: () => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const { workspaces, property } = useApp();
  const active = useActiveWorkspace(workspaces);
  const mod = isApplePlatform() ? '⌘' : 'Ctrl';
  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden shrink-0 bg-surface-muted md:flex lg:bg-[linear-gradient(to_right,var(--pt-surface-muted)_5.75rem,var(--pt-surface)_5.75rem)]">
        <div className="sticky top-0 flex h-dvh">
          <WorkspaceRail workspaces={workspaces} active={active?.id ?? null} />
          <div className="hidden w-56 border-e border-line bg-surface lg:block">
            <SectionList workspace={active} />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
          <div className="lg:hidden">
            <IconButton label={t('app.mainNav')} icon={<Menu />} onClick={p.onNav} />
          </div>
          <div className="min-w-0 flex-1 sm:flex-none">
            <PropertySwitcher open={p.switcherOpen} onOpenChange={p.setSwitcherOpen} />
          </div>
          <button
            type="button"
            onClick={p.onPalette}
            aria-keyshortcuts="/"
            data-testid="global-search"
            className="ms-auto hidden min-h-control w-72 items-center gap-2 rounded-md border border-line-strong bg-surface-muted px-3 text-sm text-ink-muted hover:bg-surface-hover sm:flex lg:w-96"
          >
            <Search aria-hidden className="size-4" />
            <span className="flex-1 truncate text-start">{t('app.searchPlaceholder')}</span>
            <Kbd>/</Kbd>
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </button>
          <div className="ms-auto sm:hidden">
            <IconButton label={t('app.search')} icon={<Search />} onClick={p.onPalette} />
          </div>
          <IconButton label={t('help.forScreen')} icon={<CircleHelp />} onClick={p.onHelp} />
          <UserMenu onSignOut={p.onSignOut} />
        </header>
        <div className={cn(!(p.online && p.apiReachable) && 'px-3 pt-2 sm:px-4')}>
          <OfflineIndicator
            online={p.online}
            apiReachable={p.apiReachable}
            lastUpdatedAt={connectivity.lastSuccessAt ?? undefined}
            timeZone={property?.timezone ?? 'UTC'}
          />
        </div>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 outline-none sm:px-6 sm:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { workspaces } = useApp();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={t('app.mainNav')}>
      <div className="flex flex-col">
        {workspaces.map((w, i) => (
          <SectionList
            key={w.id}
            workspace={w}
            onNavigate={() => onOpenChange(false)}
            showPinned={i === workspaces.length - 1}
          />
        ))}
      </div>
    </Drawer>
  );
}
