import { legalEntityInput } from '@portico/platform/contracts';
import {
  Button,
  type ColumnDef,
  DataTable,
  Dialog,
  Field,
  Input,
  ProblemAlert,
  type ProblemDetails,
  SkeletonList,
  useToast,
} from '@portico/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LegalEntity, type LegalEntityInput } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { IntentKeys } from '../../api/intent';
import { queries, scopeKey } from '../../api/queries';
import { useApp } from '../../app/app-context';
import { useScreenAction } from '../../app/screen-actions';
import { learning } from '../../learning/progress';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';

const EMPTY = {
  name: '',
  legalName: '',
  registrationNumber: '',
  taxId: '',
  countryCode: 'MV',
  baseCurrency: 'USD',
};

/**
 * GET/POST /v1/legal-entities. Creation uses one Idempotency-Key per intent: retries of the same form reuse it,
 * so a timeout + "Try again" can never create two companies.
 */
export function LegalEntitiesPage() {
  const { t } = useTranslation();
  const { session } = useApp();
  const toast = useToast();
  const nav = useRecordNav();
  const queryClient = useQueryClient();
  const query = useQuery(queries.legalEntities(session));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const intent = useRef(new IntentKeys()).current;
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  useScreenAction('new', () => setOpen(true));

  const payload = (): LegalEntityInput => {
    const p: Record<string, string> = {
      name: form.name.trim(),
      legalName: form.legalName.trim(),
      countryCode: form.countryCode.trim().toUpperCase(),
      baseCurrency: form.baseCurrency.trim().toUpperCase(),
    };
    if (form.registrationNumber.trim()) p.registrationNumber = form.registrationNumber.trim();
    if (form.taxId.trim()) p.taxId = form.taxId.trim();
    return p as unknown as LegalEntityInput;
  };
  const create = useMutation({
    mutationFn: (body: LegalEntityInput) => api.createLegalEntity(body, intent.keyFor(body)),
    onSuccess: (r) => {
      intent.settle();
      setProblem(null);
      setOpen(false);
      setForm(EMPTY);
      toast({ tone: 'success', title: t('admin.createdLegalEntity'), description: r.data.name });
      void queryClient.invalidateQueries({ queryKey: scopeKey(session, 'legal-entities') });
    },
    onError: (e) => setProblem(problemFromUnknown(e, 'legal-entity')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = payload();
    const parsed = legalEntityInput.safeParse(body);
    if (!parsed.success) {
      setProblem({
        type: 'about:blank#client-validation',
        title: t('admin.checkFields'),
        status: 400,
        code: 'validation_failed',
        detail: t('admin.checkFieldsDetail'),
        retryable: false,
        correlationId: 'client',
        errors: parsed.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
      });
      return;
    }
    create.mutate(parsed.data);
  };
  const fieldLabel = (path: string) => t(`admin.leFields.${path.replace(/^\//, '')}`, { defaultValue: path });
  const errorFor = (k: string) => problem?.errors?.find((e) => e.path === `/${k}`)?.message;

  const columns = useMemo<ColumnDef<LegalEntity>[]>(
    () => [
      {
        id: 'name',
        header: t('admin.displayName'),
        accessor: (l) => l.name,
        hideable: false,
        width: 'minmax(12rem, 1fr)',
      },
      {
        id: 'legalName',
        header: t('admin.legalName'),
        accessor: (l) => l.legalName,
        width: 'minmax(16rem, 2fr)',
      },
      {
        id: 'country',
        header: t('admin.country'),
        accessor: (l) => l.countryCode,
        width: '6rem',
        filter: 'select',
      },
      { id: 'currency', header: t('admin.baseCurrency'), accessor: (l) => l.baseCurrency, width: '7rem' },
      {
        id: 'taxId',
        header: t('admin.taxId'),
        accessor: (l) => l.taxId ?? '',
        width: '10rem',
        cell: (l) => <span className="pt-code">{l.taxId ?? '—'}</span>,
      },
    ],
    [t],
  );

  return (
    <div>
      <PageHeader
        title={t('admin.legalEntitiesTitle')}
        subtitle={t('admin.legalEntitiesSubtitle')}
        helpKey="settings.legalEntities"
        context={false}
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)} aria-keyshortcuts="N">
            {t('admin.newLegalEntity')}
          </Button>
        }
      />
      {query.isPending && <SkeletonList rows={3} />}
      {query.isError && (
        <ProblemAlert
          problem={problemFromUnknown(query.error, 'legal-entities')}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <DataTable
          label={t('admin.legalEntitiesTitle')}
          columns={columns}
          rows={query.data}
          getRowId={(l) => l.id}
          helpKey="settings.legalEntities.table"
          onRowActivate={(l) => {
            learning.event('record:open');
            nav.openFresh('legal_entity', l.id);
          }}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setProblem(null);
        }}
        modalStrict
        title={t('admin.newLegalEntity')}
        description={t('admin.idempotencyNote')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="le-form" variant="primary" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <form
          id="le-form"
          onSubmit={submit}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          noValidate
          data-help-key="settings.legalEntities.new"
        >
          <Field label={t('admin.displayName')} required error={errorFor('name')}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('admin.legalName')} required error={errorFor('legalName')}>
            <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </Field>
          <Field label={t('admin.registrationNumber')} error={errorFor('registrationNumber')}>
            <Input
              value={form.registrationNumber}
              onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
            />
          </Field>
          <Field label={t('admin.taxId')} error={errorFor('taxId')}>
            <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </Field>
          <Field
            label={t('admin.country')}
            required
            error={errorFor('countryCode')}
            description="ISO 3166, e.g. MV"
          >
            <Input
              value={form.countryCode}
              maxLength={2}
              onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.baseCurrency')}
            required
            error={errorFor('baseCurrency')}
            description="ISO 4217, e.g. USD"
          >
            <Input
              value={form.baseCurrency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
            />
          </Field>
          {problem && (
            <div className="sm:col-span-2">
              <ProblemAlert
                problem={problem}
                fieldLabel={fieldLabel}
                onRetry={() => create.mutate(payload())}
                retrying={create.isPending}
              />
            </div>
          )}
        </form>
      </Dialog>
    </div>
  );
}
