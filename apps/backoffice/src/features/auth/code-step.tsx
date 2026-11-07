import { Button, Field, Input, ProblemAlert } from '@portico/ui';
import { useMutation } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SecondStep, type SignedIn } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { PRODUCT_NAME } from '../../config';
import { EnvironmentChip } from './environment-chip';
import {
  normalizeAuthenticatorCode,
  normalizeRecoveryCode,
  secondStepFailure,
  secondsUntil,
} from './sign-in-problems';

export interface CodeStepProps {
  step: SecondStep;
  onSignedIn: (session: SignedIn) => void;
  /** Back to the password step: `expired` when the sign-in request is over, `user` when the person chose to. */
  onRestart: (reason: 'expired' | 'user') => void;
}

/**
 * Second sign-in step (ADR-0017 §8): the 6-digit code from the person's authenticator app, or one of their recovery
 * codes. Keyboard-first — the code field has focus, Enter verifies. A wrong code is explained at the field with the
 * tries left; an expired request goes back to the password step; too many wrong codes show when to try again.
 */
export function CodeStep({ step, onSignedIn, onRestart }: CodeStepProps) {
  const { t, i18n } = useTranslation();
  const [method, setMethod] = useState<'code' | 'recovery'>('code');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const input = useRef<HTMLInputElement>(null);

  const verify = useMutation({
    mutationFn: (code: string) =>
      api.loginSecondStep({
        challengeToken: step.challengeToken,
        ...(method === 'code' ? { code } : { recoveryCode: code }),
      }),
    onSuccess: ({ data }) => onSignedIn(data),
    onError: (e) => {
      const failure = secondStepFailure(e);
      if (failure.kind === 'expired') return onRestart('expired');
      if (failure.kind === 'locked') {
        setLockedUntil(failure.until);
        setNow(new Date());
        return;
      }
      if (failure.kind === 'wrong_code') {
        const wrong = method === 'code' ? t('signIn.wrongCode') : t('signIn.wrongRecoveryCode');
        setFieldError(
          failure.triesLeft === null
            ? wrong
            : `${wrong} ${t('signIn.triesLeft', { count: failure.triesLeft })}`,
        );
        input.current?.select();
        input.current?.focus();
      }
    },
  });

  // Count down while codes are paused; the Verify button comes back when the pause is over.
  const locked = lockedUntil !== null && secondsUntil(lockedUntil, now) > 0;
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (verify.isPending || locked) return;
    const code = method === 'code' ? normalizeAuthenticatorCode(value) : normalizeRecoveryCode(value);
    if (!code) {
      setFieldError(method === 'code' ? t('signIn.codeFormat') : t('signIn.recoveryFormat'));
      input.current?.focus();
      return;
    }
    setFieldError(null);
    setLockedUntil(null);
    verify.mutate(code);
  };

  const switchMethod = () => {
    setMethod((m) => (m === 'code' ? 'recovery' : 'code'));
    setValue('');
    setFieldError(null);
    verify.reset();
  };

  const failure = verify.isError ? secondStepFailure(verify.error) : null;
  const time = lockedUntil
    ? new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(lockedUntil)
    : '';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-describedby="sign-in-code-help">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">{t('signIn.codeOrganization')}</span>
        <span className="font-medium">{step.organization.name}</span>
        <EnvironmentChip environment={step.organization.environment} />
      </div>
      <p id="sign-in-code-help" className="text-sm text-ink-muted">
        {method === 'code' ? t('signIn.codeHelp', { product: PRODUCT_NAME }) : t('signIn.recoveryHelp')}
      </p>
      {method === 'code' && step.organization.environment === 'demo' && (
        <p className="flex items-start gap-2 rounded-md border border-info-line bg-info-bg p-3 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-fg" />
          {t('signIn.demoCodeHint')}
        </p>
      )}
      {method === 'code' ? (
        <Field key="code" label={t('signIn.code')} required error={fieldError ?? undefined}>
          <Input
            ref={input}
            name="one-time-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]*"
            maxLength={7}
            autoFocus
            required
            spellCheck={false}
            className="font-mono tracking-[0.3em]"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </Field>
      ) : (
        <Field key="recovery" label={t('signIn.recoveryCode')} required error={fieldError ?? undefined}>
          <Input
            ref={input}
            name="recovery-code"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={20}
            autoFocus
            required
            spellCheck={false}
            className="font-mono tracking-wider"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </Field>
      )}
      {lockedUntil && (
        <ProblemAlert
          problem={{
            ...problemFromUnknown(verify.error, 'sign-in-code'),
            title: t('signIn.lockedTitle'),
            detail: `${t('signIn.lockedDetail', { time })} ${
              locked
                ? t('signIn.lockedWait', { seconds: secondsUntil(lockedUntil, now) })
                : t('signIn.lockedReady')
            }`,
            retryable: false,
          }}
        />
      )}
      {failure?.kind === 'other' && (
        <ProblemAlert problem={problemFromUnknown(verify.error, 'sign-in-code')} />
      )}
      <Button type="submit" variant="primary" loading={verify.isPending} disabled={locked || !value.trim()}>
        {t('signIn.verify')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" onClick={switchMethod}>
          {method === 'code' ? t('signIn.useRecoveryCode') : t('signIn.useAuthenticator')}
        </Button>
        <Button variant="ghost" onClick={() => onRestart('user')}>
          {t('signIn.startAgain')}
        </Button>
      </div>
    </form>
  );
}
