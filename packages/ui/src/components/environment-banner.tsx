import { FlaskConical, GraduationCap, type LucideIcon, Presentation, TestTubeDiagonal } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';

export const NON_LIVE_ENVIRONMENTS = ['demo', 'trial', 'training', 'sandbox'] as const;
export type NonLiveEnvironment = (typeof NON_LIVE_ENVIRONMENTS)[number];
export type EnvironmentName = NonLiveEnvironment | 'live';

const spec: Record<NonLiveEnvironment, { icon: LucideIcon; bar: string; frame: string; text: string }> = {
  demo: {
    icon: Presentation,
    bar: '[--pt-hatch-a:var(--pt-env-demo-bg)] [--pt-hatch-b:var(--pt-env-demo-stripe)]',
    frame: 'var(--pt-env-demo-bg)',
    text: 'text-[var(--pt-env-fg)]',
  },
  trial: {
    icon: FlaskConical,
    bar: '[--pt-hatch-a:var(--pt-env-trial-bg)] [--pt-hatch-b:var(--pt-env-trial-stripe)]',
    frame: 'var(--pt-env-trial-bg)',
    text: 'text-[var(--pt-env-fg)]',
  },
  training: {
    icon: GraduationCap,
    bar: '[--pt-hatch-a:var(--pt-env-training-bg)] [--pt-hatch-b:var(--pt-env-training-stripe)]',
    frame: 'var(--pt-env-training-bg)',
    text: 'text-[var(--pt-env-training-fg)]',
  },
  sandbox: {
    icon: TestTubeDiagonal,
    bar: '[--pt-hatch-a:var(--pt-env-sandbox-bg)] [--pt-hatch-b:var(--pt-env-sandbox-bg)] border-b-4 border-[var(--pt-env-sandbox-stripe)]',
    frame: 'var(--pt-env-sandbox-stripe)',
    text: 'text-[var(--pt-env-fg)]',
  },
};

export function isNonLiveEnvironment(env: string | undefined | null): env is NonLiveEnvironment {
  return (NON_LIVE_ENVIRONMENTS as readonly string[]).includes(env ?? '');
}

export interface EnvironmentBannerProps {
  environment: EnvironmentName | string;
  /** Organization name shown in the banner so people with several organizations know where they are. */
  organizationName?: string | undefined;
  /** Draw a coloured frame around the whole viewport as well (default true) — visible in any screenshot. */
  frame?: boolean;
}

/**
 * Persistent, non-dismissible banner for non-live environments (demo, trial, training, sandbox). Renders
 * nothing in `live`. It is a landmark (role="region") placed before the app so it is announced first.
 */
export function EnvironmentBanner({ environment, organizationName, frame = true }: EnvironmentBannerProps) {
  const { strings } = useUi();
  if (!isNonLiveEnvironment(environment)) return null;
  const s = spec[environment];
  const Icon = s.icon;
  const label = strings.environment.kinds[environment];
  return (
    <>
      <section
        aria-label={`${strings.environment.label}: ${label}`}
        data-environment={environment}
        className={cn(
          'pt-hatch relative z-40 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-sm',
          s.bar,
          s.text,
        )}
      >
        <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.12em]">
          <Icon aria-hidden className="size-4" strokeWidth={2.5} />
          {label}
        </span>
        <span className="font-medium">{strings.environment.descriptions[environment]}</span>
        {organizationName && <span className="ms-auto font-semibold opacity-95">{organizationName}</span>}
      </section>
      {frame && (
        <div
          aria-hidden
          data-environment-frame={environment}
          className="pointer-events-none fixed inset-0 z-[70] border-4"
          style={{ borderColor: s.frame }}
        />
      )}
    </>
  );
}
