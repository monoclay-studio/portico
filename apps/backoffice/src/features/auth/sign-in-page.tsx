import { Button, cn, Field, Input, ProblemAlert } from '@portico/ui';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Building2, Info } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type LoginResponse, type SecondStep, type SignedIn } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { rememberOrgChoices } from '../../api/org-choices';
import { sessionStore } from '../../api/session';
import { PRODUCT_NAME, VENDOR_NAME } from '../../config';
import { CodeStep } from './code-step';
import { EnvironmentChip } from './environment-chip';
import { SetupStep } from './setup-step';
import { isCompanySignInRequired } from './sign-in-problems';

type Choice = Extract<LoginResponse, { status: 'select_organization' }>['organizations'][number];

/**
 * POST /v1/auth/login — password, then (when the account belongs to several organizations) the organization, then
 * (when the person has two-step verification) the code from their authenticator app. People without two-step
 * verification are offered the set-up right after signing in, because sensitive actions need it.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/sign-in' });
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);
  const [offerSetup, setOfferSetup] = useState(false);
  /** After an expired code step: the organization already chosen, so the password goes straight back to it. */
  const [resume, setResume] = useState<{ email: string; organizationId: string } | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);
  const radioName = useId();

  const enterApp = () => {
    setPassword('');
    setOfferSetup(false);
    const target =
      search.redirect?.startsWith('/') && !search.redirect.startsWith('//') ? search.redirect : '/';
    void navigate({ to: target });
  };

  const signedIn = (data: SignedIn) => {
    if (!choices) rememberOrgChoices([data.organization]);
    sessionStore.set({
      token: data.token,
      expiresAt: data.expiresAt,
      userId: data.userId,
      organization: data.organization,
    });
  };

  const login = useMutation({
    mutationFn: (organizationId?: string) =>
      api.login({ email, password, ...(organizationId ? { organizationId } : {}) }),
    onSuccess: ({ data }) => {
      setCodeExpired(false);
      if (data.status === 'select_organization') {
        rememberOrgChoices(data.organizations);
        setChoices(data.organizations);
        setOrgId(data.organizations[0]?.id ?? null);
        return;
      }
      if (data.status === 'mfa_required') {
        if (!choices) rememberOrgChoices([data.organization]);
        setPassword('');
        setSecondStep(data);
        return;
      }
      // Signed in with the password alone: this person has no two-step verification yet — offer it.
      signedIn(data);
      setOfferSetup(true);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const resumeOrg = resume && resume.email === email ? resume.organizationId : undefined;
    login.mutate(choices ? (orgId ?? undefined) : resumeOrg);
  };

  const restart = (reason: 'expired' | 'user') => {
    setResume(
      reason === 'expired' && secondStep ? { email, organizationId: secondStep.organization.id } : null,
    );
    setCodeExpired(reason === 'expired');
    setSecondStep(null);
    setChoices(null);
    setPassword('');
    login.reset();
  };

  const step = offerSetup ? 'setup' : secondStep ? 'code' : choices ? 'organization' : 'password';
  const heading = {
    password: t('signIn.title'),
    organization: t('signIn.chooseOrganization'),
    code: t('signIn.codeTitle'),
    setup: t('signIn.setupTitle'),
  }[step];

  return (
    <main id="main" className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-lg font-bold text-on-accent"
          >
            {PRODUCT_NAME.charAt(0)}
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
            <p className="text-xs text-ink-muted">{t('signIn.subtitle', { product: PRODUCT_NAME })}</p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-4 text-xl font-semibold">{heading}</h1>
          {step === 'password' && !login.isError && (codeExpired || search.reason) && (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-md border border-info-line bg-info-bg p-3 text-sm text-ink"
            >
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-fg" />
              {codeExpired
                ? t('signIn.codeExpired')
                : search.reason === 'expired'
                  ? t('signIn.sessionExpired')
                  : t('signIn.signedOut')}
            </p>
          )}
          {step === 'setup' && <SetupStep password={password} onDone={enterApp} />}
          {step === 'code' && secondStep && (
            <CodeStep
              step={secondStep}
              onSignedIn={(data) => {
                signedIn(data);
                enterApp();
              }}
              onRestart={restart}
            />
          )}
          {(step === 'password' || step === 'organization') && (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              {step === 'password' ? (
                <>
                  <Field label={t('signIn.email')} required>
                    <Input
                      type="email"
                      name="email"
                      autoComplete="username"
                      inputMode="email"
                      autoFocus={!codeExpired}
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
                      autoFocus={codeExpired}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm text-ink-muted">
                    {t('signIn.chooseOrganizationHelp')}
                  </legend>
                  {choices?.map((o) => (
                    <label
                      key={o.id}
                      className={cn(
                        'flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2',
                        orgId === o.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-line hover:bg-surface-hover',
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
                <ProblemAlert
                  problem={(() => {
                    const pr = problemFromUnknown(login.error, 'sign-in');
                    if (isCompanySignInRequired(login.error))
                      return {
                        ...pr,
                        title: t('signIn.companySignInTitle'),
                        detail: t('signIn.companySignInDetail'),
                        retryable: false,
                      };
                    return pr.status === 401
                      ? {
                          ...pr,
                          title: t('signIn.wrongCredentials'),
                          detail: t('signIn.wrongCredentialsDetail'),
                          retryable: false,
                        }
                      : pr;
                  })()}
                  onRetry={() => login.mutate(orgId ?? undefined)}
                />
              )}
              <Button
                type="submit"
                variant="primary"
                loading={login.isPending}
                disabled={step === 'organization' ? !orgId : !email || !password}
              >
                {step === 'organization' ? t('signIn.continue') : t('signIn.submit')}
              </Button>
              {step === 'organization' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChoices(null);
                    setPassword('');
                    setResume(null);
                    login.reset();
                  }}
                >
                  {t('signIn.back')}
                </Button>
              )}
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-ink-muted">{t('signIn.footer')}</p>
        <p className="mt-1 text-center text-xs text-ink-subtle">
          {PRODUCT_NAME} · {VENDOR_NAME}
        </p>
      </div>
    </main>
  );
}
