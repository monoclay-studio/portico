import { parseVersionTag, versionTag } from '@portico/db';
import { ValidationError } from '@portico/kernel';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/** Required `Idempotency-Key` header for money-moving and creating commands. */
export function requireIdempotencyKey(req: FastifyRequest): string {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new ValidationError(
      'idempotency_key_required',
      'This action needs an Idempotency-Key header (1–200 characters) so that retries never repeat it. Generate a new key per intended action and reuse it only when retrying.',
    );
  }
  return key;
}

/** Required `If-Match` version for updates to versioned records. */
export function requireIfMatch(req: FastifyRequest): number {
  const v = parseVersionTag(req.headers['if-match'] as string | undefined);
  if (v === undefined) {
    throw new ValidationError(
      'if_match_required',
      'Send the If-Match header with the version you last saw (from the ETag) so we can detect changes made by other users.',
    );
  }
  return v;
}

export function setVersion(reply: FastifyReply, version: number): FastifyReply {
  return reply.header('ETag', versionTag(version));
}

// Shared schema building blocks (also used in module contracts).
export const uuid = z.uuid();
export const localDate = z.iso.date();
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
export const idParams = z.object({ id: z.uuid() });
