import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, UiProvider, type UiStringsOverride } from '@portico/ui';
import { type ReactNode, useEffect, useMemo } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { isApiError } from '../api';
import { applyDocumentLocale, dirOf, i18n } from '../i18n';
import { density as densityStore } from './density';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry only what is safe and might succeed: network failures and retryable server problems.
        retry: (count, error) => count < 2 && (!isApiError(error) || error.problem.retryable),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

function UiBridge({ children }: { children: ReactNode }) {
  const { t, i18n: inst } = useTranslation();
  const lng = inst.resolvedLanguage ?? 'en';
  const strings = useMemo(() => t('ui', { returnObjects: true }) as UiStringsOverride, [t]);
  const density = densityStore.use();
  useEffect(() => applyDocumentLocale(lng), [lng]);
  return (
    <UiProvider strings={strings} locale={lng} dir={dirOf(lng)} weekStartsOn={0} density={density}>
      <Toaster>{children}</Toaster>
    </UiProvider>
  );
}

export function Providers({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <UiBridge>{children}</UiBridge>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
