import { DataText, EmptyState, ProvenanceBadge, StatusBadge } from '@portico/ui';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/app-context';
import { DOMAIN_BINDINGS } from '../../data/sources';
import { Facts, PageHeader, Panel } from '../common/page-header';

/** GET /v1/organization — plus an honest list of what in this build is live vs simulated. */
export function OrganizationPage() {
  const { t } = useTranslation();
  const { organization, properties } = useApp();
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
                {t('admin.module')}
              </th>
              <th scope="col" className="py-2 text-start font-medium">
                {t('provenanceNote.source')}
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              { domain: t('admin.bindingSignIn'), module: 'identity', mode: 'live' as const },
              { domain: t('admin.bindingSettings'), module: 'platform + identity', mode: 'live' as const },
              {
                domain: t('admin.bindingSearch'),
                module: 'records (platform provider)',
                mode: 'live' as const,
              },
              ...DOMAIN_BINDINGS,
            ].map((b) => (
              <tr key={b.domain} className="border-b border-line last:border-b-0">
                <td className="py-2">{b.domain}</td>
                <td className="py-2 pt-code text-ink-muted">{b.module}</td>
                <td className="py-2">
                  {b.mode === 'live' ? (
                    <StatusBadge vocabulary="availability" value="available" label={t('admin.liveApi')} />
                  ) : (
                    <ProvenanceBadge provenance="simulated" />
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
