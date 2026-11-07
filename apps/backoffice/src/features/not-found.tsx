import { Button, EmptyState } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto max-w-xl p-8">
      <EmptyState
        icon={<MapPinOff />}
        title={t('notFound.title')}
        description={t('notFound.help')}
        action={
          <Button asChild variant="primary">
            <Link to="/">{t('nav.workspaces')}</Link>
          </Button>
        }
      />
    </main>
  );
}
