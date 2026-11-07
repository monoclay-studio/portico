import { useTranslation } from 'react-i18next';
import type { SourceProvenance } from '../../data/sources';

/**
 * One line saying where this screen's data comes from — driven by the provenance the source returned (never
 * hard-coded). The page header carries the one provenance badge (C9.2); this is its plain-words explanation.
 * Live data needs no note.
 */
export function SourceNote({ provenance }: { provenance: SourceProvenance | undefined; timeZone?: string }) {
  const { t } = useTranslation();
  if (!provenance || provenance.kind === 'live') return null;
  const text = t(`provenanceNote.${provenance.kind}`, { defaultValue: '' });
  if (!text) return null;
  return (
    <p className="mb-3 text-sm text-ink-muted" data-source-note={provenance.kind}>
      {text}
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
