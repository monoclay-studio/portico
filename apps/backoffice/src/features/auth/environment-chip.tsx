import { cn, isNonLiveEnvironment, useUi } from '@portico/ui';

/** Live / Demo / Training… next to an organization name, so staff always know where they are signing in. */
export function EnvironmentChip({ environment }: { environment: string }) {
  const { strings } = useUi();
  const nonLive = isNonLiveEnvironment(environment);
  const label = nonLive ? strings.environment.kinds[environment] : 'Live';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide',
        nonLive
          ? 'border-pending-line bg-pending-bg text-pending-fg'
          : 'border-success-line bg-success-bg text-success-fg',
      )}
    >
      {label}
    </span>
  );
}
