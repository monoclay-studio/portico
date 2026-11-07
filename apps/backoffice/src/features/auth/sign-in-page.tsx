import { Button, cn, Field, Input, isNonLiveEnvironment, ProblemAlert, useUi } from '@portico/ui';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Building2, Info } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LoginResponse } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { rememberOrgChoices } from '../../api/org-choices';
import { sessionStore } from '../../api/session';
import { PRODUCT_NAME, VENDOR_NAME } from '../../config';

type Choice = Extract<LoginResponse, { status: 'select_organization' }>['organizations'][number];

function EnvironmentChip({ environment }: { environment: string }) {
  const { strings } = useUi();
  const nonLive = isNonLiveEnvironment(environment);
  const label = nonLive ? strings.environment.kinds[environment] : 'Live';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide',
        nonLive ? 'border-pending-line bg-pending-bg text-pending-fg' : 'border-success-line bg-success-bg text-success-fg',
      )}
    >
      {label}
    </span>
  );
}

/** POST /v1/auth/login — with organization selection when the account belongs to several organizations. */
export function SignInPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/sign-in' });
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const radioName = useId();

  const login = useMutation({
    mutationFn: (organizationId?: string) =>
      api.login({ email, password, ...(organizationId ? { organizationId } : {}) }),
    onSuccess: ({ data }) => {
      if (data.status === 'select_organization') {
        rememberOrgChoices(data.organizations);
        setChoices(data.organizations);
        setOrgId(data.organizations[0]?.id ?? null);
        return;
      }
      if (!choices) rememberOrgChoices([data.organization]);
      sessionStore.set({ token: data.token, expiresAt: data.expiresAt, userId: data.userId, organization: data.organization });
      setPassword('');
      const target = search.redirect && search.redirect.startsWith('/') && !search.redirect.startsWith('//') ? search.redirect : '/';
      void navigate({ to: target });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(choices ? (orgId ?? undefined) : undefined);
  };

  return (
    <main id="main" className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-lg font-bold text-on-accent">
            {PRODUCT_NAME.charAt(0)}
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
            <p className="text-xs text-ink-muted">{t('signIn.subtitle', { product: PRODUCT_NAME })}</p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-4 text-xl font-semibold">{choices ? t('signIn.chooseOrganization') : t('signIn.title')}</h1>
          {(search.reason === 'expired' || search.reason === 'signed_out') && !login.isError && !choices && (
            <p role="status" className="mb-4 flex items-start gap-2 rounded-md border border-info-line bg-info-bg p-3 text-sm text-ink">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-fg" />
              {search.reason === 'expired' ? t('signIn.sessionExpired') : t('signIn.signedOut')}
            </p>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {!choices ? (
              <>
                <Field label={t('signIn.email')} required>
                  <Input
                    type="email"
                    name="email"
                    autoComplete="username"
                    inputMode="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label={t('signIn.password')} required>
                  <Input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm text-ink-muted">{t('signIn.chooseOrganizationHelp')}</legend>
                {choices.map((o) => (
                  <label
                    key={o.id}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2',
                      orgId === o.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover',
                    )}
                  >
                    <input
                      type="radio"
                      name={radioName}
                      value={o.id}
                      checked={orgId === o.id}
                      onChange={() => setOrgId(o.id)}
                      className="size-4 accent-[var(--pt-accent)]"
                    />
                    <Building2 aria-hidden className="size-4 text-ink-muted" />
                    <span className="flex-1 text-sm font-medium">{o.name}</span>
                    <EnvironmentChip environment={o.environment} />
                  </label>
                ))}
              </fieldset>
            )}
            {login.isError && (
              <ProblemAlert problem={problemFromUnknown(login.error, 'sign-in')} onRetry={() => login.mutate(orgId ?? undefined)} />
            )}
            <Button type="submit" variant="primary" loading={login.isPending} disabled={choices ? !orgId : !email || !password}>
              {choices ? t('signIn.continue') : t('signIn.submit')}
            </Button>
            {choices && (
              <Button
                variant="ghost"
                onClick={() => {
                  setChoices(null);
                  setPassword('');
                  login.reset();
                }}
              >
                {t('signIn.back')}
              </Button>
            )}
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-ink-muted">{t('signIn.footer')}</p>
        <p className="mt-1 text-center text-xs text-ink-subtle">
          {PRODUCT_NAME} · {VENDOR_NAME}
        </p>
      </div>
    </main>
  );
}
