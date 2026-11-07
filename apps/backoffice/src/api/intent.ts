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
    // Only a hash is kept: the payload can hold secrets (an initial password) that must not linger in memory.
    const fingerprint = fingerprintOf(payload);
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

/** Non-cryptographic 53-bit hash (cyrb53) of the canonical payload. A collision only reuses a key, which the
 * server answers with 409 idempotency_conflict — never a duplicate effect. */
export function fingerprintOf(payload: unknown): string {
  const str = stableStringify(payload) ?? 'undefined';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
