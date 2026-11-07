import { cn, DataText } from '@portico/ui';
import { Link } from '@tanstack/react-router';
import { BookOpen, Compass, Dumbbell, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/app-context';
import { resolveHelp } from '../../learning/help-map';
import { type LearningPath, type LessonKind, pathsFor } from '../../learning/paths';
import { learning } from '../../learning/progress';
import { PageHeader } from '../common/page-header';
import { FirstRunChecklist } from './first-run-checklist';
import { PractiseInTraining } from './practise-in-training';

const kindIcon: Record<LessonKind, typeof BookOpen> = {
  tour: Compass,
  article: BookOpen,
  video: PlayCircle,
  practice: Dumbbell,
};

function PathCard({ path, done, userId }: { path: LearningPath; done: readonly string[]; userId: string }) {
  const { t } = useTranslation();
  const completed = path.lessons.filter((l) => done.includes(`${path.id}:${l.id}`)).length;
  const ratio = completed / Math.max(1, path.lessons.length);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      aria-labelledby={`path-${path.id}`}
      data-learning-path={path.id}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`path-${path.id}`} className="font-semibold">
          {t(`learn.paths.${path.id}`)}
        </h3>
        <DataText>{t('learn.progress', { done: completed, total: path.lessons.length })}</DataText>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-viz-seq-track"
        role="progressbar"
        aria-label={t(`learn.paths.${path.id}`)}
        aria-valuemin={0}
        aria-valuemax={path.lessons.length}
        aria-valuenow={completed}
      >
        <div className="h-full rounded-full bg-viz-seq" style={{ width: `${ratio * 100}%` }} />
      </div>
      <ol className="flex flex-col gap-1.5">
        {path.lessons.map((l) => {
          const id = `${path.id}:${l.id}`;
          const isDone = done.includes(id);
          const Icon = kindIcon[l.kind];
          const link = resolveHelp(l.helpKey);
          const title = t(l.titleKey);
          return (
            <li key={l.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--pt-accent)]"
                checked={isDone}
                aria-label={t('learn.markDone', { lesson: title })}
                onChange={() => learning.toggleLesson(userId, id)}
              />
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn(isDone && 'text-ink-muted line-through')}>{title}</span>
                <span className="pt-data text-ink-muted">
                  {t(`learn.kinds.${l.kind}`)} · {t('learn.minutes', { count: l.minutes })} · {l.helpKey}
                  {!link && ` · ${t('learn.noContentYet')}`}
                </span>
              </span>
              {l.to && (
                <Link
                  to={l.to}
                  className="shrink-0 text-xs font-medium text-accent underline underline-offset-2"
                >
                  {t('learn.open')}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** In-app learning centre: role learning paths with progress, first-run checklist and practice entry. */
export function LearnPage() {
  const { t } = useTranslation();
  const { me, property } = useApp();
  const progress = learning.use(me.userId);
  const { recommended, others } = pathsFor(
    me.roles.map((r) => r.key),
    property?.profile,
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('learn.title')}
        subtitle={t('learn.subtitle')}
        helpKey="learning.centre"
        context={false}
      />
      <FirstRunChecklist />
      <PractiseInTraining />
      <h2 className="text-sm font-semibold">{t('learn.recommended')}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {recommended.map((p) => (
          <PathCard key={p.id} path={p} done={progress.lessons} userId={me.userId} />
        ))}
      </div>
      {others.length > 0 && (
        <>
          <h2 className="text-sm font-semibold">{t('learn.otherPaths')}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {others.map((p) => (
              <PathCard key={p.id} path={p} done={progress.lessons} userId={me.userId} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
