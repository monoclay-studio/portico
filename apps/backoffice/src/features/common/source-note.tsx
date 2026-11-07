import { ProvenanceBadge } from '@portico/ui';
import { useTranslation } from 'react-i18next';
import type { SourceProvenance } from '../../data/sources';

/**
 * One line saying where this screen's data comes from — driven by the provenance the source returned
 * (never hard-coded). Live data needs no note.
 */
export function SourceNote({
  provenance,
  timeZone,
}: {
  provenance: SourceProvenance | undefined;
  timeZone?: string;
}) {
  const { t } = useTranslation();
  if (!provenance || provenance.kind === 'live') return null;
  return (
    <p
      className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted"
      data-source-note={provenance.kind}
    >
      <ProvenanceBadge
        provenance={provenance.kind}
        {...(provenance.generatedAt ? { generatedAt: provenance.generatedAt } : {})}
        {...(provenance.lastSyncedAt ? { lastSyncedAt: provenance.lastSyncedAt } : {})}
        {...(provenance.system ? { system: provenance.system } : {})}
        {...(timeZone ? { timeZone } : {})}
        compact
      />
      <span>{t(`provenanceNote.${provenance.kind}`, { defaultValue: '' })}</span>
    </p>
  );
}

/** A screen whose data source is not connected for this organization (live, nothing bound yet). */
export function NotConnected({ what }: { what: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-lg border border-dashed border-line-strong bg-surface p-6 text-sm"
      data-not-connected
    >
      <p className="font-semibold text-ink">{t('notConnected.title', { what })}</p>
      <p className="mt-1 text-ink-muted">{t('notConnected.detail')}</p>
    </div>
  );
}
