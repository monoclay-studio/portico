import type { ReactNode } from 'react';
import type { Provenance } from '../provenance-badge';
import type { StatusVocabulary } from '../status-badge';

/**
 * Universal record anatomy (docs/product/experience-architecture.md §1; kernel `records.ts`). Structural copies
 * of the kernel types so the design system has no server dependency.
 */
export interface RecordAction {
  action: string;
  label: string;
  enabled: boolean;
  reason?: string;
  previewRequired?: boolean;
}

export interface RecordIssue {
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  owner?: { kind: 'user' | 'department'; id: string; name?: string };
  since?: string;
}

export interface RecordOwner {
  kind: 'user' | 'department';
  id: string;
  name?: string;
}

export interface RecordLink {
  rel: string;
  type: string;
  id: string;
  title?: string;
}

export interface RecordSummary {
  type: string;
  id: string;
  title: string;
  subtitle?: string | undefined;
  status?: Record<string, string> | undefined;
  propertyId: string | null;
  label?: string | undefined;
}

export interface HistoryEntry {
  at: string;
  action: string;
  actor: { kind: string; label: string };
  reason: string | null;
  before?: unknown;
  after?: unknown;
}

/** A status chip: either a known vocabulary (StatusBadge) or a free family (e.g. property status). */
export interface RecordStatusChip {
  family: string;
  value: string;
  vocabulary?: StatusVocabulary;
  label?: string;
}

export interface RecordSection {
  id: string;
  title: string;
  content: ReactNode;
  /** Progressive disclosure: rarely used details start collapsed. */
  collapsed?: boolean;
  helpKey?: string;
}

export interface RecordModel {
  type: string;
  id: string;
  /** Human type label ("Stay", "Property"). */
  typeLabel: string;
  title: string;
  /** Reference code (booking code, property code) — rendered in the data voice. */
  code?: string;
  subtitle?: string;
  status: RecordStatusChip[];
  provenance?: { kind: Provenance; system?: string; lastSyncedAt?: string };
  actions: RecordAction[];
  issues: RecordIssue[];
  owner?: RecordOwner;
  sections: RecordSection[];
  links: RecordLink[];
  /** helpKey for the record screen (`<module>.<screen>`). */
  helpKey: string;
}

export type HistoryState =
  | { state: 'loading' }
  | { state: 'ready'; items: HistoryEntry[] }
  | { state: 'unavailable' }
  | { state: 'error'; message: string };
