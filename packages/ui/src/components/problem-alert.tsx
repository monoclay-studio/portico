import { CircleAlert, Copy, Hourglass, RefreshCw, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { Button } from './button';
import type { ProblemDetails } from './problem';

export interface ProblemAlertProps {
  problem: ProblemDetails;
  /** Called by the "Try again" button (shown only when the problem is retryable). Reuse the same idempotency key. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Extra recovery actions (e.g. "Open the latest version"). */
  actions?: ReactNode;
  /** Map a field path ("/email") to a human label. */
  fieldLabel?: (path: string) => string;
  className?: string;
}

/**
 * Renders an RFC 9457 problem: what happened (title + detail, which also explains recovery), field errors,
 * whether a retry is safe, and the reference id to quote to support. Announced as an alert.
 */
export function ProblemAlert({
  problem,
  onRetry,
  retrying,
  actions,
  fieldLabel,
  className,
}: ProblemAlertProps) {
  const { strings } = useUi();
  const [copied, setCopied] = useState(false);
  // An unknown outcome is shown as pending verification — never as a failure, never as "nothing happened".
  const unknownOutcome = problem.outcome === 'unknown';
  const severe = !unknownOutcome && (problem.status >= 500 || problem.status === 0);
  const Icon = unknownOutcome ? Hourglass : severe ? TriangleAlert : CircleAlert;
  // Offer "Try again" only when the problem is retryable AND the caller did not mark the request unsafe to repeat.
  const canRetry = problem.retryable && problem.safeToRetry !== false && Boolean(onRetry);
  const hint =
    canRetry && problem.safeToRetry === true
      ? problem.retryBasis === 'idempotency_key'
        ? strings.problem.retrySafeKeyed
        : problem.retryBasis === 'read'
          ? strings.problem.retrySafeRead
          : null
      : null;
  const showReference = Boolean(problem.correlationId) && !problem.correlationId.startsWith('client');
  return (
    <div
      role="alert"
      data-problem-code={problem.code}
      {...(unknownOutcome ? { 'data-outcome': 'unknown' } : {})}
      className={cn(
        'flex gap-3 rounded-md border border-s-4 p-3 text-sm',
        unknownOutcome
          ? 'border-pending-line border-s-pending-solid bg-pending-bg'
          : severe
            ? 'border-danger-line border-s-danger-solid bg-danger-bg'
            : 'border-warning-line border-s-warning-solid bg-warning-bg',
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-5 shrink-0',
          unknownOutcome ? 'text-pending-fg' : severe ? 'text-danger-fg' : 'text-warning-fg',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-ink">
        <p className="font-semibold">{problem.title || strings.problem.unknownTitle}</p>
        <p>{problem.detail}</p>
        {problem.errors && problem.errors.length > 0 && (
          <div>
            <p className="font-medium">{strings.problem.fieldErrors}</p>
            <ul className="ms-5 list-disc">
              {problem.errors.map((e) => (
                <li key={`${e.path}:${e.message}`}>
                  <span className="font-medium">
                    {fieldLabel ? fieldLabel(e.path) : e.path.replace(/^\//, '')}
                  </span>
                  : {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canRetry && onRetry && (
            <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={retrying} onClick={onRetry}>
              {strings.common.retry}
            </Button>
          )}
          {actions}
          {showReference && (
            <span className="ms-auto inline-flex items-center gap-1 text-xs text-ink-muted">
              {strings.problem.reference}:<code className="font-mono text-ink">{problem.correlationId}</code>
              <button
                type="button"
                aria-label={fmt(strings.problem.copyReference, { id: problem.correlationId })}
                className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-surface-hover"
                onClick={() => {
                  void navigator.clipboard?.writeText(problem.correlationId).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                <Copy aria-hidden className="size-3.5" />
              </button>
              <span aria-live="polite">{copied ? strings.common.copied : ''}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
