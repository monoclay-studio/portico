import { EmptyState } from '@portico/ui';
import { Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '../app/app-context';
import { homeFor } from '../app/workspaces';

/** Sends each staff member to their primary role workspace. */
export function HomeRedirect() {
  const { me } = useApp();
  const { t } = useTranslation();
  const to = homeFor(me);
  if (!to) return <EmptyState title={t('admin.noAccess')} description={me.roles.map((r) => r.name).join(', ')} />;
  return <Navigate to={to} replace />;
}
