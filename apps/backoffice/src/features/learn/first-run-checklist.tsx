import { Button, cn } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleDashed, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/app-context';
import { checklistFor } from '../../learning/paths';
import { learning, useLearningProgress } from '../../learning/progress';

/** Guided first-run checklist per role; items tick themselves off as the person uses the product. */
export function FirstRunChecklist() {
  const { t } = useTranslation();
  const { me } = useApp();
  const progress = useLearningProgress(me.userId);
  const list = checklistFor(me.roles.map((r) => r.key));
  if (!list || progress.checklistDismissed) return null;
  const role = me.roles.find((r) => r.key === list.roleKey)?.name ?? list.roleKey;
  const done = list.items.filter((i) => progress.events.includes(i.doneWhen)).length;
  return (
    <section
      aria-labelledby="first-run"
      className="rounded-lg border border-accent-line bg-accent-soft/40 p-4"
      data-help-key="learning.checklist"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="first-run" className="text-sm font-semibold">
            {t('learn.checklistTitle', { role })}
          </h2>
          <p className="text-xs text-ink-muted">
            {t('learn.checklistHelp')}{' '}
            <span className="pt-data">{t('learn.progress', { done, total: list.items.length })}</span>
          </p>
        </div>
        <Button size="sm" variant="ghost" icon={<X />} onClick={() => learning.dismissChecklist(me.userId)}>
          {t('learn.dismiss')}
        </Button>
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.items.map((i) => {
          const ok = progress.events.includes(i.doneWhen);
          const Icon = ok ? CircleCheck : CircleDashed;
          const label = t(i.labelKey);
          return (
            <li
              key={i.id}
              className="flex items-center gap-2 text-sm"
              data-checklist-item={i.id}
              data-done={ok}
            >
              <Icon
                aria-hidden
                className={cn('size-4 shrink-0', ok ? 'text-success-fg' : 'text-ink-muted')}
              />
              <span className="pt-sr-only">
                {ok ? t('ui.steps.status.done') : t('ui.steps.status.pending')}:{' '}
              </span>
              {i.to && !ok ? (
                <Link to={i.to} className="text-accent underline underline-offset-2">
                  {label}
                </Link>
              ) : (
                <span className={cn(ok && 'text-ink-muted line-through')}>{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
