import { Button, Dialog, Field, Input, ProblemAlert } from '@portico/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { GraduationCap } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { orgChoices } from '../../api/org-choices';
import { sessionStore } from '../../api/session';
import { useApp } from '../../app/app-context';

/**
 * "Practise in training": switches to the account's training organization when one exists (a separate tenant —
 * nothing reaches real guests, cards or channels). Re-authenticates with organizationId; the password is never
 * stored.
 */
export function PractiseInTraining() {
  const { t } = useTranslation();
  const { me, session } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const training = orgChoices().find((o) => o.environment === 'training' && o.id !== session.organization.id);
  const inTraining = session.organization.environment === 'training';
  const login = useMutation({
    mutationFn: () =>
      api.login({ email: me.email, password, ...(training ? { organizationId: training.id } : {}) }),
    onSuccess: ({ data }) => {
      setPassword('');
      if (data.status !== 'signed_in') return;
      queryClient.clear();
      sessionStore.set({
        token: data.token,
        expiresAt: data.expiresAt,
        userId: data.userId,
        organization: data.organization,
      });
      setOpen(false);
      void navigate({ to: '/' });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
      data-help-key="learning.practise"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <GraduationCap aria-hidden className="size-4 text-ink-muted" /> {t('learn.practise')}
      </h2>
      <p className="text-sm text-ink-muted">
        {inTraining
          ? t('learn.alreadyTraining')
          : training
            ? t('learn.practiseHelp')
            : t('learn.practiseNone')}
      </p>
      {training && !inTraining && (
        <Button
          variant="primary"
          className="self-start"
          onClick={() => setOpen(true)}
          data-testid="practise-in-training"
        >
          {t('learn.practiseConfirm', { name: training.name })}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('learn.practiseConfirm', { name: training?.name ?? '' })}
        description={t('learn.practiseHelp')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="practise-form"
              variant="primary"
              loading={login.isPending}
              disabled={!password}
            >
              {t('learn.practiseSwitch')}
            </Button>
          </>
        }
      >
        <form id="practise-form" onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t('learn.practisePassword')}>
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {login.isError && <ProblemAlert problem={problemFromUnknown(login.error, 'practise')} />}
        </form>
      </Dialog>
    </section>
  );
}
