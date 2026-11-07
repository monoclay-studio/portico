import { EntityLink, ProvenanceBadge } from '@portico/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { scopeKey } from '../api/queries';
import { useApp } from '../app/app-context';
import { definitionFor } from './registry';
import { useRecordNav } from './use-record-nav';

/** Entity link bound to the app: hover preview from the record registry, click opens the record drawer. */
export function RecordLink({
  type,
  id,
  children,
  fresh,
}: {
  type: string;
  id: string;
  children: ReactNode;
  fresh?: boolean;
}) {
  const app = useApp();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const nav = useRecordNav();
  const def = definitionFor(type);
  if (!def) return <span>{children}</span>;
  const ctx = { app, t, lng: i18n.resolvedLanguage ?? 'en', queryClient };
  return (
    <EntityLink
      type={type}
      id={id}
      loadSummary={(ty, i) =>
        queryClient.fetchQuery({
          queryKey: scopeKey(app.session, 'summary', app.property?.id, ty, i),
          queryFn: () => def.summary(ctx, i),
        })
      }
      onOpen={(ty, i) => (fresh ? nav.openFresh(ty, i) : nav.open(ty, i))}
      {...(def.simulated ? { badge: <ProvenanceBadge provenance="simulated" compact /> } : {})}
    >
      {children}
    </EntityLink>
  );
}
