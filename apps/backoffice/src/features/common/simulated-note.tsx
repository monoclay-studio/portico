import { ProvenanceBadge } from '@portico/ui';
import { useTranslation } from 'react-i18next';

/** States plainly that a workspace runs on simulated data (provenance is visible — CLAUDE.md §4.16). */
export function SimulatedNote({ module, generatedAt }: { module: string; generatedAt?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface px-3 py-2 text-sm text-ink-muted">
      <ProvenanceBadge provenance="simulated" lastSyncedAt={generatedAt} />
      <span>{t('provenanceNote.simulatedWorkspace', { module })}</span>
    </div>
  );
}
