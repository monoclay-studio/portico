import { API_BASE } from '../config';
import { createApiClient } from './client';
import { connectivity } from './connectivity';
import { endpoints } from './endpoints';
import { sessionStore } from './session';

/** The app's API client: token from the session; a 401 ends the session (the router sends staff to sign-in). */
export const apiClient = createApiClient({
  baseUrl: API_BASE,
  getToken: () => sessionStore.get()?.token ?? null,
  onSessionEnded: () => sessionStore.clear('expired'),
  onReachability: (ok) => connectivity.report(ok),
});

export const api = endpoints(apiClient);

export type * from './endpoints';
export { ApiError, isApiError } from './errors';
