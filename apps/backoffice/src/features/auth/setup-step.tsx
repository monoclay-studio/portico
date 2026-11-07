import { Button, Field, Input, ProblemAlert } from '@portico/ui';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, ShieldCheck } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isApiError } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { normalizeAuthenticatorCode } from './sign-in-problems';

export interface SetupStepProps {
  /** The password the person just signed in with: the proof that set-up needs (ADR-0017 §4). Never stored. */
  password: string;
  /** Continue into the app (set up, or "Not now"). */
  onDone: () => void;
}

/**
 * Why the first code was refused: a wrong code (try again at the field), or this set-up is over (too many wrong codes,
 * or it expired after 15 minutes) and needs a new key.
 */
function setupFailure(e: unknown): 'wrong_code' | 'restart' | 'other' {
  if (!isApiError(e)) return 'other';
  if (
    e.code === 'no_pending_enrolment' ||
    (e.code === 'invalid_code' && e.problem.details?.setupDiscarded === true)
  )
    return 'restart';
  return e.code === 'invalid_code' ? 'wrong_code' : 'other';
}

/** "ABCD EFGH …" — easier to type into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Offered right after a password sign-in for people without two-step verification. Sensitive (⚑) actions need it,
 * so this is the clear next step instead of "no access" later. Three short screens: offer → key + first code →
 * recovery codes (shown once). "Not now" always continues into the app.
 */
export function SetupStep({ password, onDone }: SetupStepProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const start = useMutation({ mutationFn: () => api.startAuthenticatorSetup({ currentPassword: password }) });
  const confirm = useMutation({
    mutationFn: (c: string) => api.confirmAuthenticatorSetup(c),
    onError: (e) => {
      if (setupFailure(e) === 'wrong_code') {
        setCodeError(t('signIn.setupWrongCode'));
        codeInput.current?.select();
        codeInput.current?.focus();
      }
    },
  });
  const restart = () => {
    confirm.reset();
    setCode('');
    setCodeError(null);
    start.mutate();
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeAuthenticatorCode(code);
    if (!c) {
      setCodeError(t('signIn.codeFormat'));
      codeInput.current?.focus();
      return;
    }
    setCodeError(null);
    confirm.mutate(c);
  };

  if (confirm.isSuccess) {
    const codes = confirm.data.data.recoveryCodes;
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex items-start gap-2 text-sm text-success-fg">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('signIn.setupDone')}
        </p>
        <h2 className="text-base font-semibold">{t('signIn.recoveryCodesTitle')}</h2>
        <p className="text-sm text-ink-muted">{t('signIn.recoveryCodesHelp')}</p>
        <ul aria-label={t('signIn.recoveryCodesTitle')} className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="rounded-sm border border-line bg-canvas px-2 py-1 text-center">
              {c}
            </li>
          ))}
        </ul>
        <Button variant="primary" autoFocus onClick={onDone}>
          {t('signIn.recoveryCodesSaved')}
        </Button>
      </div>
    );
  }

  if (start.isSuccess) {
    const { secret, otpauthUri } = start.data.data;
    const failure = confirm.isError ? setupFailure(confirm.error) : null;
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
        <p className="text-sm">{t('signIn.setupStep1')}</p>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">{t('signIn.setupKey')}</span>
          <code className="select-all break-all rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-sm">
            {grouped(secret)}
          </code>
          <a className="text-sm text-accent underline" href={otpauthUri}>
            {t('signIn.setupOpenLink')}
          </a>
        </div>
        <Field label={t('signIn.setupStep2')} required error={codeError ?? undefined}>
          <Input
            ref={codeInput}
            name="one-time-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            autoFocus
            required
            className="font-mono tracking-[0.3em]"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (codeError) setCodeError(null);
            }}
          />
        </Field>
        {failure === 'restart' && (
          <ProblemAlert
            problem={{ ...problemFromUnknown(confirm.error, 'mfa-setup-confirm'), retryable: false }}
            actions={
              <Button size="sm" loading={start.isPending} onClick={restart}>
                {t('signIn.setupRestart')}
              </Button>
            }
          />
        )}
        {failure === 'other' && (
          <ProblemAlert problem={problemFromUnknown(confirm.error, 'mfa-setup-confirm')} />
        )}
        <Button type="submit" variant="primary" loading={confirm.isPending} disabled={!code.trim()}>
          {t('signIn.setupConfirm')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('signIn.setupLater')}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-sm text-ink">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        {t('signIn.setupHelp')}
      </p>
      {start.isError && <ProblemAlert problem={problemFromUnknown(start.error, 'mfa-setup-start')} />}
      <Button variant="primary" autoFocus loading={start.isPending} onClick={() => start.mutate()}>
        {t('signIn.setupNow')}
      </Button>
      <Button variant="ghost" onClick={onDone}>
        {t('signIn.setupLater')}
      </Button>
    </div>
  );
}
