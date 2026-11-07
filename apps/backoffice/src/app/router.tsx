import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { sessionStore } from '../api/session';
import { SignInPage } from '../features/auth/sign-in-page';
import { HomeRedirect } from '../features/home';
import { NotFoundPage } from '../features/not-found';
import { RouteError } from './error-boundary';
import { AppShell } from './shell/app-shell';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: z.object({
    redirect: z.string().optional(),
    reason: z.enum(['expired', 'signed_out']).optional(),
  }),
  component: SignInPage,
});

/** Design-system examples ("stories"): public, lazy-loaded, no API calls. */
const designSystemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design-system',
  component: lazyRouteComponent(() => import('../features/design-system/gallery-page'), 'GalleryPage'),
});

/** Signed-in layout. `record` is the record-drawer trail (`type:id,type:id`), valid on every screen. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  validateSearch: z.object({ record: z.string().max(600).optional() }),
  beforeLoad: ({ location }) => {
    if (!sessionStore.get()) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href, reason: sessionStore.endedReason ?? undefined },
      });
    }
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomeRedirect });
const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/today',
  component: lazyRouteComponent(() => import('../features/overview/today-page'), 'TodayPage'),
});
const myWorkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/my-work',
  component: lazyRouteComponent(() => import('../features/overview/my-work-page'), 'MyWorkPage'),
});
const learnRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/learn',
  component: lazyRouteComponent(() => import('../features/learn/learn-page'), 'LearnPage'),
});
const arrivalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/front-desk/arrivals',
  component: lazyRouteComponent(() => import('../features/front-desk/desk-page'), 'ArrivalsScreen'),
});
const inHouseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/front-desk/in-house',
  component: lazyRouteComponent(() => import('../features/front-desk/desk-page'), 'InHouseScreen'),
});
const departuresRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/front-desk/departures',
  component: lazyRouteComponent(() => import('../features/front-desk/desk-page'), 'DeparturesScreen'),
});
const housekeepingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/housekeeping',
  component: lazyRouteComponent(
    () => import('../features/housekeeping/housekeeping-page'),
    'HousekeepingPage',
  ),
});
const timelineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reservations/timeline',
  validateSearch: z.object({ stay: z.string().optional(), from: z.iso.date().optional() }),
  component: lazyRouteComponent(() => import('../features/reservations/timeline-page'), 'TimelinePage'),
});
const organizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/organization',
  component: lazyRouteComponent(() => import('../features/admin/organization-page'), 'OrganizationPage'),
});
const propertiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/properties',
  component: lazyRouteComponent(() => import('../features/admin/properties-page'), 'PropertiesPage'),
});
/** Matches the platform manifest's record route template ('/settings/properties/:id'). */
const propertyDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/properties/$propertyId',
  component: lazyRouteComponent(() => import('../features/admin/property-detail-page'), 'PropertyDetailPage'),
});
const legalEntitiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/legal-entities',
  component: lazyRouteComponent(() => import('../features/admin/legal-entities-page'), 'LegalEntitiesPage'),
});
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/users',
  component: lazyRouteComponent(() => import('../features/admin/users-page'), 'UsersPage'),
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  designSystemRoute,
  appRoute.addChildren([
    homeRoute,
    todayRoute,
    myWorkRoute,
    learnRoute,
    arrivalsRoute,
    inHouseRoute,
    departuresRoute,
    housekeepingRoute,
    timelineRoute,
    organizationRoute,
    propertiesRoute,
    propertyDetailRoute,
    legalEntitiesRoute,
    usersRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // A screen that throws shows what happened and how to recover; the shell around it keeps working.
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
