import type { TxContext } from '@portico/db';
import type { z } from 'zod';
import type { profileInput } from '../contracts';
import type { GuestProfileInput } from '../ports';
import type { Deps } from './context';

type BookingFormProfile = z.infer<typeof profileInput>;

/**
 * Map reservations' booking-form guest fields to the guests provider's ProfileInput. Channel-supplied contacts are
 * marked `source: 'channel'` (OTA proxy addresses are stored by guests as low-confidence, never as match keys).
 */
export function toGuestProfileInput(
  propertyId: string,
  p: BookingFormProfile,
  origin: { kind: 'booking' | 'channel' | 'registration'; ref?: string },
): GuestProfileInput {
  const contactSource = origin.kind === 'channel' ? 'channel' : 'reservations';
  const contactPoints: NonNullable<GuestProfileInput['contactPoints']> = [];
  if (p.email) contactPoints.push({ kind: 'email', value: p.email, isPrimary: true, source: contactSource });
  if (p.phone) contactPoints.push({ kind: 'phone', value: p.phone, isPrimary: true, source: contactSource });
  return {
    propertyId,
    ...(p.firstName ? { givenName: p.firstName } : {}),
    familyName: p.lastName,
    ...(p.nationality ? { nationality: p.nationality } : {}),
    ...(p.birthDate ? { dateOfBirth: p.birthDate } : {}),
    ...(p.language ? { language: p.language } : {}),
    ...(contactPoints.length ? { contactPoints } : {}),
    source: { kind: origin.kind, ...(origin.ref ? { ref: origin.ref } : {}) },
  };
}

export async function resolveGuest(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  p: BookingFormProfile,
  origin: { kind: 'booking' | 'channel' | 'registration'; ref?: string },
  matchStrategy: 'exact_only' | 'suggest' | 'create_new',
): Promise<string> {
  return (
    await deps.ports.guests.resolveProfile(tx, toGuestProfileInput(propertyId, p, origin), { matchStrategy })
  ).profileId;
}
