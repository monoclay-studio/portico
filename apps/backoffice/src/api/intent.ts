/**
 * Idempotency keys per user intent (CLAUDE.md §4.7, ADR-0005).
 *
 * One intent = one thing the user means to do once ("create this legal entity"). The first attempt creates a
 * key; every retry of the SAME payload reuses it, so a timeout followed by "Try again" can never create a
 * duplicate. A different payload is a different intent and gets a new key (the server would otherwise answer
 * 409 idempotency_conflict). After success the intent is settled and the next submission starts fresh.
 */
export class IntentKeys {
  private current: { key: string; fingerprint: string } | null = null;
  constructor(private readonly newKey: () => string = () => crypto.randomUUID()) {}

  keyFor(payload: unknown): string {
    const fingerprint = stableStringify(payload);
    if (this.current && this.current.fingerprint === fingerprint) return this.current.key;
    this.current = { key: this.newKey(), fingerprint };
    return this.current.key;
  }

  /** Call after a confirmed success: the next submission is a new intent. */
  settle(): void {
    this.current = null;
  }

  get pendingKey(): string | null {
    return this.current?.key ?? null;
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}
