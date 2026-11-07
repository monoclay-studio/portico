import { createHmac } from 'node:crypto';

/**
 * The demo authenticator (ADR-0017 rule 16): `pnpm --filter @portico/api seed:demo` enrols this fixed secret for every
 * fictitious demo user and prints it beside the demo password. Demo organizations only; identity refuses it anywhere
 * else. Used by the e2e fixtures and the back-office dev seed to answer the sign-in code step like an authenticator
 * app would (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps). No Playwright imports, so scripts can use it too.
 */
export const DEMO_TOTP_SECRET = 'PORTICODEMOAUTHENTICATORDEMOKEYS';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpForStep(step: number, secret = DEMO_TOTP_SECRET): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Codes are single-use per person (the server remembers the last time step used), and the server accepts the previous,
 * current and next step. This process remembers what it used per email, so consecutive sign-ins never replay a code.
 * Another process (an earlier run, the dev seed) may have used a step this one does not know about: callers try the
 * candidates oldest first and mark each as used; a refused code only means "already used", and a success resets the
 * server's wrong-code counter.
 */
const lastUsed = new Map<string, number>();

export function codeCandidates(email: string, now = Date.now()): Array<{ step: number; code: string }> {
  const current = Math.floor(now / STEP_MS);
  const from = Math.max(current - 1, (lastUsed.get(email) ?? Number.NEGATIVE_INFINITY) + 1);
  const out: Array<{ step: number; code: string }> = [];
  for (let step = from; step <= current + 1; step++) out.push({ step, code: totpForStep(step) });
  return out;
}

export function markCodeUsed(email: string, step: number): void {
  lastUsed.set(email, Math.max(lastUsed.get(email) ?? Number.NEGATIVE_INFINITY, step));
}

/** Wait until the next time step starts (a new code becomes usable). */
export function untilNextStep(now = Date.now()): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, STEP_MS - (now % STEP_MS) + 250));
}

/**
 * Answer the code step with the demo authenticator: tries the usable codes oldest first, waiting for a fresh step
 * when this process has used them all. `attempt` returns 'ok', 'wrong_code' (try the next one) or throws.
 */
export async function answerWithDemoCode(
  email: string,
  attempt: (code: string) => Promise<'ok' | 'wrong_code'>,
): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (const { step, code } of codeCandidates(email)) {
      const outcome = await attempt(code);
      markCodeUsed(email, step);
      if (outcome === 'ok') return;
    }
    await untilNextStep();
  }
  throw new Error(`No demo authenticator code was accepted for ${email}`);
}
