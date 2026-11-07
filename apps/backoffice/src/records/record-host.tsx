import { type HistoryState, ProblemAlert, RecordDrawer, RecordView, useHotkey, useToast } from '@portico/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { problemFromUnknown } from '../api/errors';
import { useApp } from '../app/app-context';
import { ExtendStayDialog } from '../features/reservations/extend-stay-dialog';
import { RecordLink } from './entity-link';
import { definitionFor, type RecordCtx, serverHistory } from './registry';
import { pinnedRecords, recentRecords } from './stores';
import { useRecordNav } from './use-record-nav';

const titles = new Map<string, string>();

/** Renders the record drawer for the trail in the URL (`?record=`) over whatever screen is open. */
export function RecordHost() {
  const app = useApp();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const nav = useRecordNav();
  const [extendStay, setExtendStay] = useState<string | null>(null);
  const top = nav.trail.at(-1);
  const def = top ? definitionFor(top.type) : undefined;
  const ctx: RecordCtx = { app, t, lng: i18n.resolvedLanguage ?? 'en', queryClient };
  const userId = app.me.userId;
  const pinned = pinnedRecords.use(userId);

  const record = useQuery({
    queryKey: ['record', app.session.organization.id, app.property?.id, top?.type, top?.id],
    queryFn: async () => (top && def ? def.load(ctx, top.id) : null),
    enabled: Boolean(top && def),
  });
  const model = record.data?.model;
  const needsServerHistory = record.data?.history === 'server';
  const history = useQuery({
    queryKey: ['history', app.session.organization.id, top?.type, top?.id],
    queryFn: () => serverHistory(top?.type ?? '', top?.id ?? ''),
    enabled: Boolean(top) && needsServerHistory,
  });

  const lastRecent = useRef<string | null>(null);
  useEffect(() => {
    if (!model) return;
    titles.set(`${model.type}:${model.id}`, model.title);
    const key = `${model.type}:${model.id}`;
    if (lastRecent.current !== key) {
      lastRecent.current = key;
      recentRecords.add(userId, { type: model.type, id: model.id, title: model.title });
    }
  }, [model, userId]);

  // E = edit when a record is open and offers it.
  useHotkey(
    'e',
    () => {
      const edit = model?.actions.find((a) => a.action === 'edit' && a.enabled);
      if (edit && model && def?.onAction) def.onAction(ctx, model, edit, handlers);
    },
    { enabled: Boolean(model) },
  );

  if (!top) return null;
  const handlers = {
    navigate: (to: string, search?: Record<string, string>) =>
      void router.navigate({ to, search: search ?? {} } as never),
    toast,
    openExtend: (id: string) => setExtendStay(id),
    openRecord: nav.open,
  };
  const historyState: HistoryState =
    record.data?.history && record.data.history !== 'server'
      ? record.data.history
      : (history.data ?? { state: 'loading' });
  const isPinned = model ? pinned.some((p) => p.type === model.type && p.id === model.id) : false;
  const fullPage = def?.fullPage && top ? def.fullPage(top.id) : undefined;

  return (
    <>
      <RecordDrawer
        title={model ? `${model.typeLabel}: ${model.title}` : t('common.loading')}
        loading={record.isPending}
        trail={nav.trail.map((e) => ({
          key: `${e.type}:${e.id}`,
          title: titles.get(`${e.type}:${e.id}`) ?? t(`records.types.${e.type}`, { defaultValue: e.type }),
        }))}
        onNavigateTrail={nav.jump}
        onBack={nav.back}
        onClose={nav.close}
        onOpenFullPage={fullPage ? () => void router.navigate({ to: fullPage } as never) : undefined}
      >
        {record.isError && (
          <ProblemAlert
            problem={problemFromUnknown(record.error, 'record')}
            onRetry={() => void record.refetch()}
          />
        )}
        {record.isSuccess && !model && <p className="text-sm text-ink-muted">{t('records.notFound')}</p>}
        {model && (
          <RecordView
            model={model}
            history={historyState}
            describeAction={(a) => t(`records.history.${a}`, { defaultValue: a })}
            pinned={isPinned}
            onTogglePin={() =>
              isPinned
                ? pinnedRecords.remove(userId, model)
                : pinnedRecords.add(userId, { type: model.type, id: model.id, title: model.title })
            }
            onAction={(a) => def?.onAction?.(ctx, model, a, handlers)}
            renderLink={(l) => (
              <RecordLink type={l.type} id={l.id}>
                {l.title ?? l.id}
              </RecordLink>
            )}
          />
        )}
      </RecordDrawer>
      {extendStay && app.property && (
        <ExtendStayDialog
          property={app.property}
          stayId={extendStay}
          open
          onOpenChange={(o) => {
            if (!o) {
              setExtendStay(null);
              void record.refetch();
            }
          }}
        />
      )}
    </>
  );
}
