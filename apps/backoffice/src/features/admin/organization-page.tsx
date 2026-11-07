import { DataText, EmptyState, ProvenanceBadge } from '@portico/ui';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/app-context';
import { type BindingMode, bindWorkspaceSources, DOMAINS } from '../../data/sources';
import { Facts, PageHeader, Panel } from '../common/page-header';

/** GET /v1/organization — plus an honest list of what in this build is live vs simulated. */
export function OrganizationPage() {
  const { t } = useTranslation();
  const { organization, properties, session } = useApp();
  const bound = bindWorkspaceSources(session.organization.environment);
  if (!organization) return <EmptyState title={t('admin.noAccess')} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={organization.name}
        subtitle={t('admin.organizationTitle')}
        helpKey="settings.organization"
        context={false}
      />
      <Panel title={t('records.sections.details')}>
        <Facts
          items={[
            [
              t('admin.slug'),
              <span key="s" className="pt-code">
                {organization.slug}
              </span>,
            ],
            [t('admin.environment'), organization.environment],
            [t('admin.plan'), organization.planCode],
            [t('admin.status'), organization.status],
            [t('admin.defaultLocale'), organization.defaultLocale],
            [
              t('nav.properties'),
              <DataText key="p">{t('admin.propertyCount', { count: properties.length })}</DataText>,
            ],
          ]}
        />
      </Panel>
      <Panel title={t('admin.whatIsLive')} helpKey="settings.organization.bindings">
        <p className="mb-3 text-sm text-ink-muted">{t('admin.whatIsLiveHelp')}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs text-ink-muted">
              <th scope="col" className="py-2 text-start font-medium">
                {t('admin.capability')}
              </th>
              <th scope="col" className="py-2 text-start font-medium">
                {t('provenanceNote.source')}
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              { id: 'signIn', label: t('admin.bindingSignIn'), mode: 'live' as BindingMode },
              { id: 'settings', label: t('admin.bindingSettings'), mode: 'live' as BindingMode },
              { id: 'search', label: t('admin.bindingSearch'), mode: 'live' as BindingMode },
              ...DOMAINS.map((d) => ({ id: d, label: t(`admin.domains.${d}`), mode: bound.modes[d] })),
            ].map((b) => (
              <tr key={b.id} className="border-b border-line last:border-b-0">
                <td className="py-2">{b.label}</td>
                <td className="py-2">
                  {b.mode === 'not_connected' ? (
                    <span className="text-ink-muted">{t('admin.notConnected')}</span>
                  ) : (
                    <ProvenanceBadge provenance={b.mode} compact />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
