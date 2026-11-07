import {
  ChangePreview,
  Dialog,
  Field,
  formatTime,
  ProblemAlert,
  type ProblemDetails,
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
import { workspaceSource } from '../../data/sources';
import { SimulatedProblem } from '../../mocks/adapter';
import { toSimProperty } from '../common/sim-property';

function toProblem(e: unknown): ProblemDetails {
  if (e instanceof SimulatedProblem) {
    return {
      type: `about:blank#simulated-${e.code}`,
      title: e.status === 409 ? 'Conflict' : 'Cannot complete this action',
      status: e.status,
      code: e.code,
      detail: e.message,
      retryable: false,
      correlationId: `sim-${Date.now().toString(36)}`,
    };
  }
  return problemFromUnknown(e, 'extend-stay');
}

/**
 * Extend a stay: change preview (availability, price, taxes, deposits, balance) → explicit confirm.
 * SIMULATED until the reservations module merges; the dialog shows that on its face.
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
  const sim = toSimProperty(property);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [open]);
  const preview = useQuery({
    queryKey: ['sim', property.id, property.businessDate, 'preview-extend', stayId, nights],
    queryFn: () => workspaceSource.previewExtension(sim, stayId, nights),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const commit = useMutation({
    mutationFn: () => workspaceSource.commitExtension(sim, preview.data?.data.token ?? '', stayId, nights),
    onSuccess: () => {
      toast({ tone: 'success', title: t('timeline.committed') });
      void queryClient.invalidateQueries({ queryKey: ['sim', property.id] });
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
          <ProblemAlert problem={toProblem(preview.error)} onRetry={() => void preview.refetch()} />
        )}
        {data && (
          <ChangePreview
            title={t('timeline.previewHeading')}
            provenance={<ProvenanceBadge provenance={preview.data?.provenance ?? 'simulated'} />}
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
            problem={commit.isError ? <ProblemAlert problem={toProblem(commit.error)} /> : undefined}
          />
        )}
      </div>
    </Dialog>
  );
}
