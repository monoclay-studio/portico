import {
  ChangePreview,
  Dialog,
  Field,
  formatTime,
  ProblemAlert,
  ProvenanceBadge,
  Select,
  SkeletonList,
  useToast,
} from '@portico/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Property } from '../../api';
import { problemFromUnknown } from '../../api/errors';
import { IntentKeys } from '../../api/intent';
import { useWorkspace } from '../../data/use-workspace';

/**
 * Extend a stay: change preview (availability, price, taxes, deposits, balance) → explicit confirm.
 * Its provenance (simulated, sandbox, live) comes from the source and is shown on its face.
 */
export function ExtendStayDialog({
  property,
  stayId,
  open,
  onOpenChange,
  defaultNights = 2,
}: {
  property: Property;
  stayId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultNights?: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [nights, setNights] = useState(defaultNights);
  const [now, setNow] = useState(() => Date.now());
  const ws = useWorkspace();
  const changes = ws.source('stayChanges');
  // One confirm = one intent = one idempotency key, reused if the same confirm is retried.
  const [intent] = useState(() => new IntentKeys());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [open]);
  const preview = useQuery({
    queryKey: ws.key('stayChanges', 'preview-extend', stayId, nights),
    queryFn: () =>
      changes && ws.property
        ? changes.previewExtension(ws.property, stayId, nights)
        : Promise.reject(new Error('unbound')),
    enabled: open && Boolean(changes && ws.property),
    staleTime: 0,
    gcTime: 0,
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!changes || !ws.property) return Promise.reject(new Error('unbound'));
      const previewToken = preview.data?.data.token ?? '';
      return changes.commitExtension(ws.property, {
        previewToken,
        stayId,
        nights,
        idempotencyKey: intent.keyFor({ previewToken, stayId, nights }),
      });
    },
    onSuccess: (r) => {
      intent.settle();
      toast({
        tone: 'success',
        title: t('timeline.committed'),
        description: t('timeline.committedDetail', { date: r.data.departure }),
      });
      void queryClient.invalidateQueries({ queryKey: ws.key('frontDesk').slice(0, 5) });
      onOpenChange(false);
    },
  });
  const data = preview.data?.data;
  const stale = data ? new Date(data.validUntil).getTime() < now : false;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) commit.reset();
        onOpenChange(o);
      }}
      size="lg"
      title={data?.title ?? t('timeline.extend')}
      description={data?.summary}
    >
      <div className="flex flex-col gap-4">
        <div className="w-48">
          <Field label={t('timeline.extendNights')}>
            <Select
              value={String(nights)}
              onValueChange={(v) => {
                commit.reset();
                setNights(Number(v));
              }}
              options={[1, 2, 3].map((n) => ({
                value: String(n),
                label: t('timeline.nightsOption', { count: n }),
              }))}
            />
          </Field>
        </div>
        {preview.isPending && <SkeletonList rows={4} />}
        {preview.isError && (
          <ProblemAlert
            problem={problemFromUnknown(preview.error, 'extend-stay')}
            onRetry={() => void preview.refetch()}
          />
        )}
        {data && (
          <ChangePreview
            title={t('timeline.previewHeading')}
            provenance={preview.data && <ProvenanceBadge provenance={preview.data.provenance.kind} compact />}
            blockers={data.feasible ? [] : data.blockers}
            sections={data.sections}
            consequences={data.consequences}
            validUntil={formatTime(data.validUntil, property.timezone)}
            stale={stale}
            onRefresh={() => {
              setNow(Date.now());
              void preview.refetch();
            }}
            onBack={() => onOpenChange(false)}
            onConfirm={() => commit.mutate()}
            confirming={commit.isPending}
            problem={
              commit.isError ? (
                <ProblemAlert problem={problemFromUnknown(commit.error, 'extend-stay')} />
              ) : undefined
            }
          />
        )}
      </div>
    </Dialog>
  );
}
