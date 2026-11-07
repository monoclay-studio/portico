import { propertyProfile } from '@portico/platform/contracts';
import {
  Button,
  Combobox,
  ConflictDialog,
  type ConflictDialogRow,
  classifyConflict,
  Field,
  formatRelative,
  Input,
  ProblemAlert,
  type ProblemDetails,
  RecordPage,
  Select,
  SkeletonList,
  useToast,
} from '@portico/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Property, type PropertyUpdate } from '../../api';
import { isApiError, problemFromUnknown } from '../../api/errors';
import { queries, scopeKey } from '../../api/queries';
import { useApp } from '../../app/app-context';
import { PageHeader } from '../common/page-header';

type Editable = Pick<Property, 'name' | 'profile' | 'timezone' | 'checkInTime' | 'checkOutTime' | 'status'>;
const KEYS = ['name', 'profile', 'timezone', 'checkInTime', 'checkOutTime', 'status'] as const;

const pick = (p: Property): Editable => ({
  name: p.name,
  profile: p.profile,
  timezone: p.timezone,
  checkInTime: p.checkInTime,
  checkOutTime: p.checkOutTime,
  status: p.status,
});

function diff(base: Editable, form: Editable): PropertyUpdate {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) if (form[k] !== base[k]) out[k] = form[k];
  return out as PropertyUpdate;
}

const timeZones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Indian/Maldives', 'UTC'];
  }
})();

interface ConflictState {
  rows: ConflictDialogRow[];
  latest: Property;
  latestVersion: number;
  expected: number;
  changedBy?: string;
  changedAt?: string;
}

/**
 * Property settings (PATCH /v1/properties/:id with If-Match). A 409 version_conflict opens the ConflictDialog:
 * your change vs the saved version, field by field, then re-apply on top of the latest version — no lost
 * update, no silent overwrite (scenario S14 pattern).
 */
export function PropertyDetailPage() {
  const { t, i18n } = useTranslation();
  const { propertyId } = useParams({ strict: false }) as { propertyId: string };
  const { session } = useApp();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery(queries.property(session, propertyId));
  const [base, setBase] = useState<{ value: Editable; version: number } | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);

  // Snapshot what the user opened; background refetches must not move the base under their edits.
  useEffect(() => {
    if (query.data && !base) {
      setBase({ value: pick(query.data.property), version: query.data.version });
      setForm(pick(query.data.property));
    }
  }, [query.data, base]);

  const accept = (p: Property, version: number) => {
    setBase({ value: pick(p), version });
    setForm(pick(p));
    queryClient.setQueryData(queries.property(session, propertyId).queryKey, {
      property: p,
      version,
    });
    void queryClient.invalidateQueries({ queryKey: scopeKey(session, 'properties') });
  };

  /**
   * 409 version_conflict: load the latest version and who changed it, then show the three-way comparison.
   * Used for the first save and again if a re-apply meets yet another change (P2-7). If loading the latest
   * version fails, the person still gets an explanation (never an unhandled rejection).
   */
  const openConflict = async (original: Editable, mine: Editable, expected: number, failure: unknown) => {
    try {
      const latest = await api.property(propertyId);
      const latestVersion = latest.version ?? latest.data.version;
      const history = await api.recordHistory('property', propertyId).catch(() => null);
      const lastChange = history?.data.items.filter((i) => i.action === 'platform.property.update').at(-1);
      const rows = classifyConflict(original, mine, pick(latest.data), KEYS).map((r) => ({
        ...r,
        label: t(`admin.fields.${r.key}`),
        ...(r.key === 'profile' ? { format: (v: unknown) => t(`profiles.${String(v)}`) } : {}),
      }));
      setConflict({
        rows,
        latest: latest.data,
        latestVersion,
        expected,
        ...(lastChange
          ? {
              changedBy: lastChange.actor.label,
              changedAt: formatRelative(lastChange.at, new Date(), i18n.resolvedLanguage),
            }
          : {}),
      });
    } catch {
      setConflict(null);
      setProblem(problemFromUnknown(failure, 'property-save'));
    }
  };
  const isVersionConflict = (e: unknown) =>
    isApiError(e) && e.status === 409 && e.code === 'version_conflict';

  const save = useMutation({
    mutationFn: async (v: { patch: PropertyUpdate; version: number }) =>
      api.updateProperty(propertyId, v.patch, v.version),
    onSuccess: (r) => {
      setProblem(null);
      const version = r.version ?? r.data.version;
      accept(r.data, version);
      toast({ tone: 'success', title: t('admin.savedProperty', { version }) });
    },
    onError: async (e, vars) => {
      if (isVersionConflict(e) && base && form) {
        await openConflict(base.value, { ...base.value, ...vars.patch } as Editable, vars.version, e);
        return;
      }
      setProblem(problemFromUnknown(e, 'property-save'));
    },
  });

  const reapply = useMutation({
    mutationFn: async (v: { patch: PropertyUpdate; version: number; original: Editable; mine: Editable }) =>
      api.updateProperty(propertyId, v.patch, v.version),
    onSuccess: (r) => {
      accept(r.data, r.version ?? r.data.version);
      setConflict(null);
      toast({ tone: 'success', title: t('admin.conflictResolved') });
    },
    onError: async (e, vars) => {
      // Someone changed it AGAIN while this person was re-applying: compare against the newest version.
      if (isVersionConflict(e)) await openConflict(vars.original, vars.mine, vars.version, e);
    },
  });

  /**
   * The save's answer never arrived (outcome unknown): ask Portico what is saved now, instead of guessing.
   * Applied → accept it; untouched → the edits are still here to save again; changed by someone else → conflict.
   */
  const verify = useMutation({
    mutationFn: () => api.property(propertyId),
    onSuccess: async (latest) => {
      if (!base || !form) return;
      const version = latest.version ?? latest.data.version;
      const saved = pick(latest.data);
      const wanted = diff(base.value, form) as Record<string, unknown>;
      const applied = Object.entries(wanted).every(([k, v]) => saved[k as keyof Editable] === v);
      setProblem(null);
      if (applied && version !== base.version) {
        accept(latest.data, version);
        toast({ tone: 'success', title: t('admin.verifiedSaved', { version }) });
      } else if (version === base.version) {
        toast({ tone: 'info', title: t('admin.verifiedNotSaved') });
      } else {
        await openConflict(base.value, form, base.version, null);
      }
    },
    onError: (e) => setProblem(problemFromUnknown(e, 'property-verify')),
  });

  const dirty = useMemo(
    () => (base && form ? Object.keys(diff(base.value, form)).length > 0 : false),
    [base, form],
  );

  if (query.isPending || !form || !base) return <SkeletonList rows={6} />;
  if (query.isError)
    return (
      <ProblemAlert
        problem={problemFromUnknown(query.error, 'property')}
        onRetry={() => void query.refetch()}
      />
    );
  const p = query.data.property;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ patch: diff(base.value, form), version: base.version });
  };
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <RecordPage
      back={
        <Link
          to="/settings/properties"
          className="inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t('admin.propertiesTitle')}
        </Link>
      }
    >
      <PageHeader
        title={p.name}
        subtitle={t('admin.propertySettingsHelp')}
        meta={
          <span className="pt-data text-ink-muted">{t('common.version', { version: base.version })}</span>
        }
        helpKey="settings.properties.edit"
        context={false}
      />
      <form
        onSubmit={submit}
        className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2"
        data-help-key="settings.properties.edit.form"
        noValidate
      >
        <Field label={t('admin.fields.name')} required className="sm:col-span-2">
          <Input
            name="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label={t('admin.fields.profile')}>
          <Select
            value={form.profile}
            onValueChange={(v) => set('profile', v as Editable['profile'])}
            options={propertyProfile.options.map((o) => ({ value: o, label: t(`profiles.${o}`) }))}
          />
        </Field>
        <Field label={t('admin.fields.timezone')}>
          <Combobox
            value={form.timezone}
            onValueChange={(v) => v && set('timezone', v)}
            options={timeZones.map((z) => ({ value: z, label: z }))}
          />
        </Field>
        <Field label={t('admin.fields.checkInTime')} description={t('admin.localTime')}>
          <Input
            name="checkInTime"
            type="time"
            value={form.checkInTime}
            onChange={(e) => set('checkInTime', e.target.value)}
          />
        </Field>
        <Field label={t('admin.fields.checkOutTime')} description={t('admin.localTime')}>
          <Input
            name="checkOutTime"
            type="time"
            value={form.checkOutTime}
            onChange={(e) => set('checkOutTime', e.target.value)}
          />
        </Field>
        <Field label={t('admin.fields.status')}>
          <Select
            value={form.status}
            onValueChange={(v) => set('status', v as Editable['status'])}
            options={(['setup', 'pilot', 'active', 'inactive'] as const).map((s) => ({
              value: s,
              label: t(`admin.statuses.${s}`),
            }))}
          />
        </Field>
        {problem && (
          <div className="sm:col-span-2">
            <ProblemAlert
              problem={problem}
              onRetry={() => save.mutate({ patch: diff(base.value, form), version: base.version })}
              actions={
                problem.outcome === 'unknown' ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={verify.isPending}
                    onClick={() => verify.mutate()}
                  >
                    {t('admin.checkSaved')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setForm(base.value)}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
      {conflict && (
        <ConflictDialog
          open
          onOpenChange={(o) => !o && setConflict(null)}
          entity={t('records.types.property').toLowerCase()}
          rows={conflict.rows}
          expectedVersion={conflict.expected}
          currentVersion={conflict.latestVersion}
          changedBy={conflict.changedBy}
          changedAt={conflict.changedAt}
          reapplying={reapply.isPending}
          onDiscard={() => {
            accept(conflict.latest, conflict.latestVersion);
            setConflict(null);
            toast({ tone: 'info', title: t('admin.discarded') });
          }}
          onReapply={(keys) => {
            const patch: Record<string, unknown> = {};
            for (const r of conflict.rows) if (keys.includes(r.key)) patch[r.key] = r.mine;
            const original = pick(conflict.latest);
            const mine = { ...original, ...(patch as Partial<Editable>) };
            // Re-apply on top of the latest version; the form shows the merged result while saving.
            setBase({ value: original, version: conflict.latestVersion });
            setForm(mine);
            reapply.mutate({
              patch: patch as PropertyUpdate,
              version: conflict.latestVersion,
              original,
              mine,
            });
          }}
        >
          {reapply.isError && !isVersionConflict(reapply.error) && (
            <ProblemAlert problem={problemFromUnknown(reapply.error, 'property-reapply')} />
          )}
        </ConflictDialog>
      )}
    </RecordPage>
  );
}
