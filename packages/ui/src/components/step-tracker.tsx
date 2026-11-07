import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Hourglass,
  type LucideIcon,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Button } from './button';

export type StepStatus = 'done' | 'failed' | 'pending' | 'in_progress' | 'skipped' | 'pending_verification';

export interface WorkflowStep {
  id: string;
  label: ReactNode;
  status: StepStatus;
  /** What happened / who / when, e.g. "Passport scanned by Aishath at 10:58". */
  detail?: ReactNode;
  /** For failed steps: the problem and how to fix it. */
  error?: ReactNode;
}

const spec: Record<StepStatus, { icon: LucideIcon; className: string }> = {
  done: { icon: CircleCheck, className: 'text-success-fg' },
  failed: { icon: XCircle, className: 'text-danger-fg' },
  pending: { icon: CircleDashed, className: 'text-ink-subtle' },
  in_progress: { icon: CircleDot, className: 'text-info-fg' },
  skipped: { icon: CircleSlash, className: 'text-ink-subtle' },
  pending_verification: { icon: Hourglass, className: 'text-pending-fg' },
};

export interface StepTrackerProps {
  steps: readonly WorkflowStep[];
  title?: ReactNode;
  /** Continue the workflow from the first unfinished step (done steps are never repeated). */
  onResume?: () => void;
  onRetryStep?: (id: string) => void;
  resuming?: boolean;
  className?: string;
}

/** Resumable workflow progress: which steps completed, which failed and why, what is left (brief §6). */
export function StepTracker({ steps, title, onResume, onRetryStep, resuming, className }: StepTrackerProps) {
  const { strings } = useUi();
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const unfinished = done < steps.length;
  return (
    <section
      className={cn('flex flex-col gap-3', className)}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          <p className="text-xs text-ink-muted">
            {fmt(strings.steps.progress, { done, total: steps.length })}
          </p>
        </div>
        {unfinished && onResume && (
          <Button size="sm" variant="primary" icon={<Play />} loading={resuming} onClick={onResume}>
            {strings.steps.resume}
          </Button>
        )}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label={fmt(strings.steps.progress, { done, total: steps.length })}
      >
        <div
          className="h-full bg-success-solid"
          style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const s = spec[step.status];
          const Icon = s.icon;
          return (
            <li key={step.id} data-step-status={step.status} className="relative flex gap-3 pb-3 last:pb-0">
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute start-[0.6875rem] top-6 bottom-0 w-px bg-line" />
              )}
              <Icon
                aria-hidden
                className={cn('relative mt-0.5 size-[1.375rem] shrink-0 bg-surface', s.className)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-sm font-medium">{step.label}</span>
                  <span className={cn('text-xs font-medium', s.className)}>
                    {strings.steps.status[step.status]}
                  </span>
                </div>
                {step.detail && <div className="text-xs text-ink-muted">{step.detail}</div>}
                {step.status === 'failed' && step.error && (
                  <div className="mt-1 rounded-sm border border-danger-line bg-danger-bg px-2 py-1 text-xs text-ink">
                    {step.error}
                  </div>
                )}
                {step.status === 'failed' && onRetryStep && (
                  <Button
                    size="sm"
                    variant="link"
                    className="self-start"
                    icon={<RotateCcw />}
                    onClick={() => onRetryStep(step.id)}
                  >
                    {strings.steps.retryStep}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
