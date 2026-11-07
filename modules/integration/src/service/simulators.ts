/**
 * Control of the simulated PMS (demonstrations, training, trials and tests): create an account with fictional
 * data, inject faults, and generate activity inside the "external" system. Simulated data is never presented as
 * real, and simulators are never available in a live organization (F8: a simulator can never become a system of
 * record for real operations).
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, requirePermission } from '@portico/kernel';
import type { SimAccountHandle } from '../connectors/pms-simulator';
import type { SimulatorEventInput, SimulatorFaults } from '../contracts';
import { P } from '../manifest';
import type { IntegrationDeps } from './common';

export function assertSimulatorsAllowed(tx: Pick<TxContext, 'environment'>): void {
  if (tx.environment === 'live') {
    throw new BusinessRuleError(
      'simulator_not_in_live',
      'Simulated systems are available in demo, trial, training and sandbox organizations only. A live organization connects to real systems, so real operations never depend on a simulator.',
    );
  }
}

export async function createPmsSimulator(
  tx: TxContext,
  deps: IntegrationDeps,
  input: { seed: boolean; keyExpiresAt?: string | undefined; readOnlyKey?: boolean | undefined },
): Promise<{ accountId: string; apiKey: string; notice: string }> {
  requirePermission(tx, P.simulatorControl);
  assertSimulatorsAllowed(tx);
  const { account, apiKey } = await deps.simulators.pms.createAccount(tx.tenantId, {
    keyExpiresAt: input.keyExpiresAt ? new Date(input.keyExpiresAt) : null,
    readOnlyKey: input.readOnlyKey ?? false,
    tx,
    ...(input.seed ? { seedAt: tx.now } : {}),
  });
  await tx.audit({
    action: 'integration.simulator.create',
    target: { type: 'integration_simulator', id: account.accountId },
    after: { property: account.property.code, seeded: input.seed, readOnlyKey: input.readOnlyKey ?? false },
  });
  return {
    accountId: account.accountId,
    apiKey,
    notice:
      'Simulated PMS with fictional data. Store the API key now: it is shown once. Use it in a connection to the "Simulated PMS" connector.',
  };
}

async function account(tx: TxContext, deps: IntegrationDeps, accountId: string): Promise<SimAccountHandle> {
  requirePermission(tx, P.simulatorControl);
  const a = await deps.simulators.pms.get(tx.tenantId, accountId, tx);
  if (!a) throw new NotFoundError('simulator', accountId);
  return a;
}

export async function describePmsSimulator(tx: TxContext, deps: IntegrationDeps, accountId: string) {
  const a = await account(tx, deps, accountId);
  return {
    accountId: a.accountId,
    property: { code: a.property.code, name: a.property.name, currency: a.property.currency },
    faults: await a.getFaults(tx),
    pendingMessages: await a.pendingCount(undefined, tx),
    appliedCommands: (await a.appliedCommands(tx)).length,
    provenance: 'simulated' as const,
  };
}

export async function setPmsSimulatorFaults(
  tx: TxContext,
  deps: IntegrationDeps,
  accountId: string,
  faults: SimulatorFaults,
) {
  const a = await account(tx, deps, accountId);
  const result = await a.setFaults(faults, tx);
  await tx.audit({
    action: 'integration.simulator.faults',
    target: { type: 'integration_simulator', id: accountId },
    after: result,
  });
  return result;
}

export async function generatePmsSimulatorEvent(
  tx: TxContext,
  deps: IntegrationDeps,
  accountId: string,
  input: SimulatorEventInput,
) {
  const a = await account(tx, deps, accountId);
  switch (input.type) {
    case 'reservation': {
      if (input.action === 'create') {
        const r = await a.createReservation(
          tx.now,
          {
            ...(input.reservationId ? { reservationId: input.reservationId } : {}),
            ...(input.roomTypeCode ? { roomTypeCode: input.roomTypeCode } : {}),
            ...(input.arrival ? { arrival: input.arrival } : {}),
            ...(input.departure ? { departure: input.departure } : {}),
          },
          tx,
        );
        return { externalId: r.reservationId, revision: r.revision };
      }
      if (!input.reservationId) throw new NotFoundError('simulated_reservation');
      const r =
        input.action === 'cancel'
          ? await a.cancelReservation(tx.now, input.reservationId, tx)
          : await a.modifyReservation(
              tx.now,
              input.reservationId,
              {
                ...(input.roomTypeCode ? { roomTypeCode: input.roomTypeCode } : {}),
                ...(input.arrival ? { arrival: input.arrival } : {}),
                ...(input.departure ? { departure: input.departure } : {}),
              },
              tx,
            );
      return { externalId: r.reservationId, revision: r.revision };
    }
    case 'roomStatus':
      await a.setRoomStatus(tx.now, input.roomNumber, input.statusCode, tx);
      return { externalId: `${a.property.code}-${input.roomNumber}`, revision: null };
    case 'charge':
      return {
        externalId: await a.postCharge(
          tx.now,
          {
            reservationId: input.reservationId,
            chargeCode: input.chargeCode,
            amountMinor: input.amountMinor,
            currency: input.currency,
          },
          tx,
        ),
        revision: 1,
      };
  }
}
