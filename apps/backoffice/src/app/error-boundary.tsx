import { ProblemAlert } from '@portico/ui';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react';
import { problemFromUnknown } from '../api/errors';

interface BoundaryProps {
  /** Where this boundary sits (becomes the client-side reference, e.g. `client:record`). */
  where: string;
  /** When this changes, a failed boundary tries again (e.g. another record opened). */
  resetKey?: unknown;
  children: ReactNode;
}
interface BoundaryState {
  failed: boolean;
  error: unknown;
  resetKey: unknown;
}

/**
 * Contains a rendering failure to the part of the screen that failed (P1-3): the rest of the app — navigation,
 * the list beside a record — keeps working, and the person sees what happened and how to recover.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.resetKey
      ? { failed: false, error: null, resetKey: props.resetKey }
      : null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[backoffice] ${this.props.where} failed to render`, error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ProblemAlert
        problem={problemFromUnknown(this.state.error, this.props.where)}
        onRetry={() => this.setState({ failed: false, error: null })}
      />
    );
  }
}

/** Router-level fallback for any screen that throws while rendering or loading. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const queryReset = useQueryErrorResetBoundary();
  useEffect(() => {
    console.error('[backoffice] screen failed', error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <ProblemAlert
        problem={problemFromUnknown(error, 'screen')}
        onRetry={() => {
          queryReset.reset();
          reset();
        }}
      />
    </div>
  );
}
