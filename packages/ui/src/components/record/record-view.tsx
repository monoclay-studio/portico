import {
  ChevronDown,
  CircleAlert,
  Ellipsis,
  Info,
  Pin,
  PinOff,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useUi } from '../../provider';
import { fmt } from '../../strings';
import { Button, IconButton } from '../button';
import { ProvenanceBadge } from '../provenance-badge';
import { humanizeCode, StatusBadge } from '../status-badge';
import { Tooltip } from '../tooltip';
import { HistoryTimeline } from './history-timeline';
import type { HistoryState, RecordAction, RecordIssue, RecordLink, RecordModel } from './types';

const severityStyle: Record<RecordIssue['severity'], { icon: ReactNode; cls: string }> = {
  blocking: { icon: <CircleAlert />, cls: 'border-s-danger-solid [&_svg]:text-danger-fg' },
  warning: { icon: <TriangleAlert />, cls: 'border-s-warning-solid [&_svg]:text-warning-fg' },
  info: { icon: <Info />, cls: 'border-s-info-solid [&_svg]:text-info-fg' },
};

/** Separate status chips (one per family — never merged) + provenance. */
export function RecordStatusChips({ model }: { model: Pick<RecordModel, 'status' | 'provenance'> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {model.status.map((c) =>
        c.vocabulary ? (
          <StatusBadge
            key={c.family}
            vocabulary={c.vocabulary}
            value={c.value}
            {...(c.label ? { label: c.label } : {})}
          />
        ) : (
          <span
            key={c.family}
            data-status-family={c.family}
            className="inline-flex items-center gap-1 rounded-sm border border-neutral-line px-1.5 text-xs leading-5 text-neutral-fg"
          >
            <span>{humanizeCode(c.family)}:</span> {c.label ?? humanizeCode(c.value)}
          </span>
        ),
      )}
      {model.provenance && (
        <ProvenanceBadge
          provenance={model.provenance.kind}
          {...(model.provenance.system ? { system: model.provenance.system } : {})}
          {...(model.provenance.lastSyncedAt ? { lastSyncedAt: model.provenance.lastSyncedAt } : {})}
          compact
        />
      )}
    </div>
  );
}

/** Next actions: up to 3 buttons, the rest in a menu. Disabled actions stay visible and say why. */
export function RecordActions({
  actions,
  onAction,
  primaryCount = 3,
}: {
  actions: readonly RecordAction[];
  onAction: (a: RecordAction) => void;
  primaryCount?: number;
}) {
  const { strings } = useUi();
  const s = strings.record;
  const primary = actions.slice(0, primaryCount);
  const rest = actions.slice(primaryCount);
  const firstEnabled = primary.findIndex((a) => a.enabled);
  return (
    <div className="flex flex-wrap items-start gap-2" data-record-actions>
      {primary.map((a, i) => {
        const button = (
          <Button
            size="sm"
            variant={i === firstEnabled ? 'primary' : 'secondary'}
            aria-disabled={!a.enabled || undefined}
            data-action={a.action}
            onClick={() => a.enabled && onAction(a)}
            aria-describedby={!a.enabled && a.reason ? `reason-${a.action}` : undefined}
          >
            {a.label}
            {a.previewRequired && <span className="pt-sr-only"> ({s.previewFirst})</span>}
          </Button>
        );
        return (
          <div key={a.action} className="flex max-w-60 flex-col gap-0.5">
            {a.enabled || !a.reason ? (
              button
            ) : (
              <Tooltip content={fmt(s.disabledBecause, { reason: a.reason })}>{button}</Tooltip>
            )}
            {!a.enabled && a.reason && (
              <span id={`reason-${a.action}`} className="text-[0.6875rem] leading-tight text-ink-muted">
                {a.reason}
              </span>
            )}
          </div>
        );
      })}
      {rest.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton size="sm" variant="secondary" label={s.moreActions} icon={<Ellipsis />} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-[60] min-w-56 rounded-md border border-line bg-surface p-1 shadow-md"
            >
              {rest.map((a) => (
                <DropdownMenu.Item
                  key={a.action}
                  disabled={!a.enabled}
                  onSelect={() => onAction(a)}
                  className="flex min-h-control-sm cursor-default flex-col items-start justify-center rounded-sm px-2 py-1 text-sm outline-none data-disabled:text-ink-muted data-highlighted:bg-accent-soft"
                >
                  <span>{a.label}</span>
                  {!a.enabled && a.reason && <span className="text-xs text-ink-muted">{a.reason}</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

export interface RecordViewProps {
  model: RecordModel;
  history: HistoryState;
  onAction: (action: RecordAction) => void;
  /** Renders a related record reference (EntityLink in apps). */
  renderLink: (link: RecordLink) => ReactNode;
  describeAction?: (action: string) => string;
  pinned?: boolean;
  onTogglePin?: () => void;
}

/** The universal record anatomy: header, next actions, issues, owner, details, related, history. */
export function RecordView({
  model,
  history,
  onAction,
  renderLink,
  describeAction,
  pinned,
  onTogglePin,
}: RecordViewProps) {
  const { strings } = useUi();
  const s = strings.record;
  return (
    <article
      className="flex flex-col gap-5"
      data-record-type={model.type}
      data-help-key={model.helpKey}
      aria-label={`${model.typeLabel}: ${model.title}`}
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="pt-data text-ink-muted">
              {model.typeLabel}
              {model.code ? ` · ${model.code}` : ''}
            </span>
            <h2 className="text-lg font-semibold leading-tight">{model.title}</h2>
            {model.subtitle && <p className="text-sm text-ink-muted">{model.subtitle}</p>}
          </div>
          {onTogglePin && (
            <IconButton
              size="sm"
              label={pinned ? s.unpin : s.pin}
              icon={pinned ? <PinOff /> : <Pin />}
              onClick={onTogglePin}
              aria-pressed={pinned}
            />
          )}
        </div>
        <RecordStatusChips model={model} />
        <RecordActions actions={model.actions} onAction={onAction} />
      </header>

      <section aria-labelledby={`${model.id}-issues`} className="flex flex-col gap-2">
        <h3 id={`${model.id}-issues`} className="text-sm font-semibold">
          {s.issues}{' '}
          {model.issues.length > 0 && <span className="pt-data text-ink-muted">({model.issues.length})</span>}
        </h3>
        {model.issues.length === 0 ? (
          <p className="text-sm text-ink-muted">{s.noIssues}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {model.issues.map((i) => {
              const st = severityStyle[i.severity];
              return (
                <li
                  key={i.code}
                  data-issue-severity={i.severity}
                  className={cn(
                    'flex items-start gap-2 rounded-sm border border-line border-s-4 bg-surface px-2.5 py-2 text-sm',
                    st.cls,
                  )}
                >
                  <span aria-hidden className="mt-0.5 inline-flex [&_svg]:size-4">
                    {st.icon}
                  </span>
                  <span className="flex min-w-0 flex-col text-ink">
                    <span>
                      <span className="font-semibold">{s.severity[i.severity]}:</span> {i.message}
                    </span>
                    {i.owner?.name && (
                      <span className="text-xs text-ink-muted">
                        {s.owner}: {i.owner.name}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-center gap-2 text-sm">
        <UserRound aria-hidden className="size-4 text-ink-muted" />
        <span className="text-ink-muted">{s.owner}:</span>
        <span className="font-medium">{model.owner?.name ?? s.noOwner}</span>
      </p>

      {model.sections.map((sec) => (
        <details
          key={sec.id}
          open={!sec.collapsed}
          className="group rounded-md border border-line"
          data-help-key={sec.helpKey}
        >
          <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold">
            {sec.title}
            <ChevronDown aria-hidden className="size-4 text-ink-muted group-open:rotate-180" />
          </summary>
          <div className="border-t border-line px-3 py-3">{sec.content}</div>
        </details>
      ))}

      <section aria-labelledby={`${model.id}-related`} className="flex flex-col gap-2">
        <h3 id={`${model.id}-related`} className="text-sm font-semibold">
          {s.related}
        </h3>
        {model.links.length === 0 ? (
          <p className="text-sm text-ink-muted">{s.noRelated}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {model.links.map((l) => (
              <li key={`${l.rel}:${l.type}:${l.id}`} className="flex items-center gap-2 text-sm">
                <span className="pt-data w-24 shrink-0 text-ink-muted">{l.rel}</span>
                {renderLink(l)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${model.id}-history`} className="flex flex-col gap-2">
        <h3 id={`${model.id}-history`} className="text-sm font-semibold">
          {s.history}
        </h3>
        <HistoryTimeline history={history} {...(describeAction ? { describeAction } : {})} />
      </section>
    </article>
  );
}
