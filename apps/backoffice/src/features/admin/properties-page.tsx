import { type ColumnDef, DataTable, ProblemAlert, SkeletonList } from '@portico/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Property } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { queries } from '../../api/queries';
import { useApp } from '../../app/app-context';
import { learning } from '../../learning/progress';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';

/** GET /v1/properties — opens each property in the record drawer (universal anatomy, live history). */
export function PropertiesPage() {
  const { t } = useTranslation();
  const { session } = useApp();
  const nav = useRecordNav();
  const query = useQuery(queries.properties(session));
  const columns = useMemo<ColumnDef<Property>[]>(
    () => [
      {
        id: 'code',
        header: t('admin.code'),
        accessor: (p) => p.code,
        width: '7rem',
        hideable: false,
        cell: (p) => <span className="pt-code font-medium">{p.code}</span>,
      },
      { id: 'name', header: t('admin.name'), accessor: (p) => p.name, width: 'minmax(14rem, 2fr)' },
      {
        id: 'profile',
        header: t('admin.profile'),
        accessor: (p) => p.profile,
        filter: 'select',
        width: '10rem',
        cell: (p) => t(`profiles.${p.profile}`),
      },
      { id: 'timezone', header: t('admin.timezone'), accessor: (p) => p.timezone, width: '10rem' },
      { id: 'currency', header: t('admin.currency'), accessor: (p) => p.baseCurrency, width: '6rem' },
      {
        id: 'businessDate',
        header: t('app.businessDate'),
        accessor: (p) => p.businessDate,
        width: '8rem',
        cell: (p) => <span className="pt-code">{p.businessDate}</span>,
      },
      { id: 'status', header: t('admin.propertyStatus'), accessor: (p) => p.status, width: '7rem' },
    ],
    [t],
  );
  return (
    <div>
      <PageHeader
        title={t('admin.propertiesTitle')}
        subtitle={t('admin.propertiesSubtitle')}
        helpKey="settings.properties"
        context={false}
      />
      {query.isPending && <SkeletonList rows={4} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'properties')}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <DataTable
          label={t('admin.propertiesTitle')}
          columns={columns}
          rows={query.data}
          getRowId={(p) => p.id}
          helpKey="settings.properties.table"
          openRowId={nav.trail[0]?.type === 'property' ? nav.trail[0].id : null}
          onRowActivate={(p) => {
            learning.event('record:open');
            nav.openFresh('property', p.id);
          }}
        />
      )}
    </div>
  );
}
