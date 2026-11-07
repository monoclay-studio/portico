/**
 * Control of the simulated PMS (demonstrations, training and tests): create an account with fictional data,
 * inject faults, and generate activity inside the "external" system. Simulated data is never presented as real.
 */
import type { TxContext } from '@portico/db';
import { NotFoundError, requirePermission } from '@portico/kernel';
import type { PmsSimulatorAccount } from '../connectors/pms-simulator';
import type { SimulatorEventInput, SimulatorFaults } from '../contracts';
import { P } from '../manifest';
import type { IntegrationDeps } from './common';

export async function createPmsSimulator(
  tx: TxContext,
  deps: IntegrationDeps,
  input: { seed: boolean; keyExpiresAt?: string | undefined; readOnlyKey?: boolean | undefined },
): Promise<{ accountId: string; apiKey: string; notice: string }> {
  requirePermission(tx, P.simulatorControl);
  const { account, apiKey } = deps.simulators.pms.createAccount(tx.tenantId, {
    keyExpiresAt: input.keyExpiresAt ? new Date(input.keyExpiresAt) : null,
    readOnlyKey: input.readOnlyKey ?? false,
    ...(input.seed ? { seedAt: tx.now } : {}),
  });
  await tx.audit({
    action: 'integration.simulator.create',
    target: { type: 'integration_simulator', id: account.accountId },
    after: {
      property: account.property.code,
      seeded: input.seed,
      readOnlyKey: input.readOnlyKey ?? false,
      apiKey: '[shown once]',
    },
  });
  return {
    accountId: account.accountId,
    apiKey,
    notice:
      'Simulated PMS with fictional data. Store the API key now: it is shown once. Use it in a connection to the "Simulated PMS" connector. Simulators live in memory and are reset when the server restarts.',
  };
}

function account(tx: TxContext, deps: IntegrationDeps, accountId: string): PmsSimulatorAccount {
  requirePermission(tx, P.simulatorControl);
  const a = deps.simulators.pms.get(tx.tenantId, accountId);
  if (!a) throw new NotFoundError('simulator', accountId);
  return a;
}

export function describePmsSimulator(tx: TxContext, deps: IntegrationDeps, accountId: string) {
  const a = account(tx, deps, accountId);
  return {
    accountId: a.accountId,
    property: { code: a.property.code, name: a.property.name, currency: a.property.currency },
    faults: a.getFaults(),
    pendingMessages: a.pendingCount(),
    appliedCommands: a.appliedCommands().length,
    provenance: 'simulated' as const,
  };
}

export async function setPmsSimulatorFaults(
  tx: TxContext,
  deps: IntegrationDeps,
  accountId: string,
  faults: SimulatorFaults,
) {
  const a = account(tx, deps, accountId);
  const result = a.setFaults(faults);
  await tx.audit({
    action: 'integration.simulator.faults',
    target: { type: 'integration_simulator', id: accountId },
    after: result,
  });
  return result;
}

export function generatePmsSimulatorEvent(
  tx: TxContext,
  deps: IntegrationDeps,
  accountId: string,
  input: SimulatorEventInput,
) {
  const a = account(tx, deps, accountId);
  switch (input.type) {
    case 'reservation': {
      if (input.action === 'create') {
        const r = a.createReservation(tx.now, {
          ...(input.reservationId ? { reservationId: input.reservationId } : {}),
          ...(input.roomTypeCode ? { roomTypeCode: input.roomTypeCode } : {}),
          ...(input.arrival ? { arrival: input.arrival } : {}),
          ...(input.departure ? { departure: input.departure } : {}),
        });
        return { externalId: r.reservationId, revision: r.revision };
      }
      if (!input.reservationId) throw new NotFoundError('simulated_reservation');
      const r =
        input.action === 'cancel'
          ? a.cancelReservation(tx.now, input.reservationId)
          : a.modifyReservation(tx.now, input.reservationId, {
              ...(input.roomTypeCode ? { roomTypeCode: input.roomTypeCode } : {}),
              ...(input.arrival ? { arrival: input.arrival } : {}),
              ...(input.departure ? { departure: input.departure } : {}),
            });
      return { externalId: r.reservationId, revision: r.revision };
    }
    case 'roomStatus':
      a.setRoomStatus(tx.now, input.roomNumber, input.statusCode);
      return { externalId: `${a.property.code}-${input.roomNumber}`, revision: null };
    case 'charge':
      return {
        externalId: a.postCharge(tx.now, {
          reservationId: input.reservationId,
          chargeCode: input.chargeCode,
          amountMinor: input.amountMinor,
          currency: input.currency,
        }),
        revision: 1,
      };
  }
}
