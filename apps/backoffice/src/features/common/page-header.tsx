import { HelpButton } from '@portico/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/app-context';
import { useHelp } from '../../learning/help-context';
import { learning } from '../../learning/progress';

/**
 * Page header (design direction): title + context (property · business date) + help anchor; filters and the
 * saved view name appear as chips in the list toolbar right below. Every screen passes a stable helpKey.
 */
export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  helpKey,
  context = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  helpKey: string;
  /** Show the property · business date context line. */
  context?: boolean;
}) {
  const { t } = useTranslation();
  const { property } = useApp();
  const { openHelp } = useHelp();
  useEffect(() => learning.event(`visit:${helpKey}`), [helpKey]);
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3" data-help-key={helpKey} data-screen={helpKey}>
      <div className="flex min-w-0 flex-col gap-1">
        {context && property && (
          <span className="pt-data text-ink-muted">
            {property.name} · {t('app.businessDate')} {property.businessDate}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {meta}
          <HelpButton helpKey={helpKey} onOpen={openHelp} />
        </div>
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  children,
  actions,
  className,
  helpKey,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  helpKey?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className ?? ''}`} data-help-key={helpKey}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Definition list for record facts. */
export function Facts({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static fact list
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-ink-muted">{k}</dt>
          <dd className="text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
