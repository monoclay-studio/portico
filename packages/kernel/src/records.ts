/**
 * The universal record contract (docs/product/experience-architecture.md §1). Every primary record returned by
 * the API carries these so every module's screens behave the same and the UI, API, integrations and AI share
 * one server-computed truth about what can be done next and what is wrong.
 */
export interface RecordAction {
  /** Stable verb, e.g. 'checkIn', 'moveUnit', 'postCharge'. */
  action: string;
  label: string;
  enabled: boolean;
  /** When disabled: why, in plain language ("Villa 214 has not passed inspection yet"). */
  reason?: string;
  /** True for consequential actions that show a change preview before commit. */
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
  /** Relationship, e.g. 'guest', 'folio', 'unit', 'booking', 'conversation'. */
  rel: string;
  type: string;
  id: string;
  title?: string;
}

/** Compact representation for search results, hover previews and related-record lists. */
export interface RecordSummary {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  /** Status chips by family, e.g. { booking: 'confirmed', payment: 'pending_verification' }. */
  status?: Record<string, string>;
  propertyId: string | null;
}

export interface SearchHit extends RecordSummary {
  /** 0..1 relevance. */
  score: number;
  /** Which field matched, for highlighting ("email", "confirmation code"). */
  matched?: string;
}

/** Declared in a module manifest so cross-module features (history, search, links) know the record type. */
export interface RecordTypeDefinition {
  /** Must equal the `target.type` used in audit entries for this record. */
  type: string;
  label: string;
  /** Permission needed to read this record (and therefore its history). */
  readPermission: string;
  /** Front-end route template, e.g. '/reservations/bookings/:id'. */
  route?: string;
}
