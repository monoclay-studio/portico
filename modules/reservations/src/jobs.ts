import { type ScheduledJob, sql, withTenantTx } from '@portico/db';
import { newId, systemContext, type TenantEnvironment } from '@portico/kernel';
import type { ReservationsService } from './service';

/**
 * Periodic jobs (run by apps/worker). `reservations.expireBookings`: held bookings whose inventory hold expired
 * become `expired` (inventory released), and tentative bookings that reached their option date raise an owner
 * issue (auto-expired only when policy `reservations.tentative.autoExpire` is on) — RES-R08/R09.
 * Tenants are found through the module's reviewed SECURITY DEFINER routing function; all work then runs inside
 * the tenant's own transaction under RLS with a system context.
 */
export function reservationsJobs(service: ReservationsService): ScheduledJob[] {
  return [
    {
      name: 'reservations.expireBookings',
      intervalSeconds: 60,
      async run(database, now) {
        const { rows } = await sql<{ tenant_id: string; property_id: string }>`
          select tenant_id, property_id from reservations.due_booking_expiries(${now})`.execute(
          database.kysely,
        );
        for (const r of rows) {
          const env = await sql<{
            e: string | null;
          }>`select platform.tenant_environment(${r.tenant_id}::uuid) as e`.execute(database.kysely);
          const ctx = systemContext(
            r.tenant_id,
            'reservations.expireBookings',
            (env.rows[0]?.e ?? 'live') as TenantEnvironment,
            newId(),
          );
          await withTenantTx(database, ctx, (tx) =>
            service.expireBookings(tx, { propertyId: r.property_id }),
          );
        }
      },
    },
  ];
}
