import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { sessionStore } from '../api/session';
import { OrganizationPage } from '../features/admin/organization-page';
import { LegalEntitiesPage } from '../features/admin/legal-entities-page';
import { PropertiesPage } from '../features/admin/properties-page';
import { PropertyDetailPage } from '../features/admin/property-detail-page';
import { UsersPage } from '../features/admin/users-page';
import { SignInPage } from '../features/auth/sign-in-page';
import { ArrivalsPage } from '../features/front-desk/arrivals-page';
import { HomeRedirect } from '../features/home';
import { HousekeepingPage } from '../features/housekeeping/housekeeping-page';
import { NotFoundPage } from '../features/not-found';
import { TimelinePage } from '../features/reservations/timeline-page';
import { AppShell } from './shell/app-shell';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: z.object({ redirect: z.string().optional(), reason: z.enum(['expired', 'signed_out']).optional() }),
  component: SignInPage,
});

/** Design-system examples ("stories"): public, lazy-loaded, no API calls. */
const designSystemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design-system',
  component: lazyRouteComponent(() => import('../features/design-system/gallery-page'), 'GalleryPage'),
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ location }) => {
    if (!sessionStore.get()) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href, reason: sessionStore.endedReason ?? undefined } });
    }
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomeRedirect });
const arrivalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/front-desk/arrivals',
  validateSearch: z.object({ stay: z.string().optional() }),
  component: ArrivalsPage,
});
const housekeepingRoute = createRoute({ getParentRoute: () => appRoute, path: '/housekeeping', component: HousekeepingPage });
const timelineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reservations/timeline',
  validateSearch: z.object({ stay: z.string().optional(), from: z.iso.date().optional() }),
  component: TimelinePage,
});
const organizationRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/organization', component: OrganizationPage });
const propertiesRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/properties', component: PropertiesPage });
const propertyDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/properties/$propertyId',
  component: PropertyDetailPage,
});
const legalEntitiesRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/legal-entities', component: LegalEntitiesPage });
const usersRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/users', component: UsersPage });

const routeTree = rootRoute.addChildren([
  signInRoute,
  designSystemRoute,
  appRoute.addChildren([
    homeRoute,
    arrivalsRoute,
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
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export { propertyDetailRoute, arrivalsRoute, timelineRoute, signInRoute };
