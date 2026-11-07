import { createUserRequest } from '@portico/identity/contracts';
import {
  Button,
  type ColumnDef,
  DataTable,
  DataText,
  Dialog,
  Field,
  Input,
  ProblemAlert,
  type ProblemDetails,
  Select,
  SkeletonList,
  Tabs,
  useToast,
} from '@portico/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type CreateUserRequest, type UserSummary } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { IntentKeys } from '../../api/intent';
import { queries } from '../../api/queries';
import { useApp } from '../../app/app-context';
import { useScreenAction } from '../../app/screen-actions';
import { learning } from '../../learning/progress';
import { useRecordNav } from '../../records/use-record-nav';
import { PageHeader } from '../common/page-header';

const EMPTY = { email: '', displayName: '', jobTitle: '', roleKey: 'front_desk', scope: 'organization', initialPassword: '' };

/** GET /v1/users + GET /v1/roles; POST /v1/users with an intent-scoped Idempotency-Key. */
export function UsersPage() {
  const { t } = useTranslation();
  const { session, properties } = useApp();
  const toast = useToast();
  const nav = useRecordNav();
  const queryClient = useQueryClient();
  const orgId = session.organization.id;
  const users = useQuery(queries.users(orgId));
  const roles = useQuery(queries.roles(orgId));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const intent = useRef(new IntentKeys()).current;
  useScreenAction('new', () => setOpen(true));
  const propName = (id: string | null) => properties.find((p) => p.id === id)?.name ?? t('admin.wholeOrganization');

  const body = (): CreateUserRequest => ({
    email: form.email.trim(),
    displayName: form.displayName.trim(),
    ...(form.jobTitle.trim() ? { jobTitle: form.jobTitle.trim() } : {}),
    ...(form.initialPassword ? { initialPassword: form.initialPassword } : {}),
    roles: [
      form.scope === 'organization'
        ? { roleKey: form.roleKey, scopeType: 'organization' }
        : { roleKey: form.roleKey, scopeType: 'property', scopeId: form.scope },
    ],
  });
  const create = useMutation({
    mutationFn: (b: CreateUserRequest) => api.createUser(b, intent.keyFor({ ...b, initialPassword: b.initialPassword ? '•' : undefined })),
    onSuccess: () => {
      intent.settle();
      setOpen(false);
      setForm(EMPTY);
      setProblem(null);
      toast({ tone: 'success', title: t('admin.createdUser') });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'users'] });
    },
    onError: (e) => setProblem(problemFromUnknown(e, 'create-user')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = createUserRequest.safeParse(body());
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
    create.mutate(body());
  };
  const errorFor = (k: string) => problem?.errors?.find((e) => e.path === `/${k}`)?.message;

  const columns = useMemo<ColumnDef<UserSummary>[]>(
    () => [
      { id: 'name', header: t('admin.name'), accessor: (u) => u.displayName, hideable: false, width: 'minmax(12rem, 1fr)' },
      { id: 'email', header: t('admin.email'), accessor: (u) => u.email, width: 'minmax(16rem, 1.5fr)', cell: (u) => <span className="pt-code truncate text-xs">{u.email}</span> },
      { id: 'status', header: t('admin.status'), accessor: (u) => u.status, width: '7rem', filter: 'select' },
      {
        id: 'roles',
        header: t('admin.roles'),
        accessor: (u) => u.roles.map((r) => r.key).join(' '),
        width: 'minmax(16rem, 2fr)',
        cell: (u) => (
          <span className="truncate text-sm">
            {u.roles.map((r) => `${r.key} · ${r.scopeType === 'organization' ? t('admin.wholeOrganization') : propName(r.scopeId)}`).join('; ')}
          </span>
        ),
      },
    ],
    // biome-ignore lint/correctness/useExhaustiveDependencies: propName derives from properties
    [t, properties],
  );

  return (
    <div>
      <PageHeader
        title={t('admin.usersTitle')}
        subtitle={t('admin.usersSubtitle')}
        helpKey="settings.users"
        context={false}
        actions={
          <Button variant="primary" icon={<UserPlus />} onClick={() => setOpen(true)} aria-keyshortcuts="N">
            {t('admin.newUser')}
          </Button>
        }
      />
      <Tabs
        aria-label={t('admin.usersTitle')}
        items={[
          {
            value: 'staff',
            label: t('admin.staffTab'),
            count: users.data?.length,
            content: users.isPending ? (
              <SkeletonList rows={4} />
            ) : users.isError ? (
              <ProblemAlert problem={problemFromUnknown(users.error, 'users')} onRetry={() => void users.refetch()} />
            ) : (
              <DataTable
                label={t('admin.usersTitle')}
                columns={columns}
                rows={users.data ?? []}
                getRowId={(u) => u.userId}
                helpKey="settings.users.table"
                onRowActivate={(u) => {
                  learning.event('record:open');
                  nav.openFresh('user', u.userId);
                }}
              />
            ),
          },
          {
            value: 'roles',
            label: t('admin.rolesTab'),
            count: roles.data?.length,
            content: roles.isError ? (
              <ProblemAlert problem={problemFromUnknown(roles.error, 'roles')} onRetry={() => void roles.refetch()} />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2" data-help-key="settings.users.roles">
                {(roles.data ?? []).map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <DataText>{t('admin.permissions', { count: r.permissions.length })}</DataText>
                    </span>
                    <span className="pt-code text-xs text-ink-muted">{r.key}</span>
                    {r.description && <span className="text-sm text-ink-muted">{r.description}</span>}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setProblem(null);
        }}
        modalStrict
        title={t('admin.newUser')}
        description={t('admin.idempotencyNote')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="user-form" variant="primary" loading={create.isPending}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate data-help-key="settings.users.new">
          <Field label={t('admin.email')} required error={errorFor('email')}>
            <Input type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t('admin.name')} required error={errorFor('displayName')}>
            <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label={t('admin.jobTitle')}>
            <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </Field>
          <Field label={t('admin.role')}>
            <Select
              value={form.roleKey}
              onValueChange={(v) => setForm({ ...form, roleKey: v })}
              options={(roles.data ?? []).map((r) => ({ value: r.key, label: r.name }))}
            />
          </Field>
          <Field label={t('admin.roleScope')}>
            <Select
              value={form.scope}
              onValueChange={(v) => setForm({ ...form, scope: v })}
              options={[{ value: 'organization', label: t('admin.wholeOrganization') }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </Field>
          <Field label={t('admin.initialPassword')} description={t('admin.initialPasswordHelp')} error={errorFor('initialPassword')}>
            <Input type="password" autoComplete="new-password" value={form.initialPassword} onChange={(e) => setForm({ ...form, initialPassword: e.target.value })} />
          </Field>
          {problem && (
            <div className="sm:col-span-2">
              <ProblemAlert
                problem={problem}
                fieldLabel={(p) => t(`admin.leFields.${p.replace(/^\//, '').split('/')[0]}`, { defaultValue: p })}
                onRetry={() => create.mutate(body())}
                retrying={create.isPending}
              />
            </div>
          )}
        </form>
      </Dialog>
    </div>
  );
}
