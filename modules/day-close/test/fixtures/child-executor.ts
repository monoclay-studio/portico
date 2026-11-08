/**
 * A separate Node process that executes a Day Close run and then HANGS inside an item's open transaction (after its
 * effects, before commit), so the parent test can SIGKILL it mid-step — a real process death, not a simulated one.
 * Usage: node --import tsx child-executor.ts <appUrl> <tenantId> <runId> <step> <hangAtIndex> <nowIso>
 */
import { createDatabase } from '@portico/db';
import { createFinance } from '@portico/finance';
import { ROLE_TEMPLATES } from '@portico/identity';
import { fixedClock, newId, staticAuthorizer } from '@portico/kernel';
import { ratesService } from '@portico/rates';
import { createDayCloseService } from '../../src';
import {
  buildPorts,
  FakeIntegration,
  FakeInventory,
  FakeOperations,
  FakePayments,
  FakeReservationsLookup,
  financePortsFor,
  ratesPortsFor,
  TEST_SEAL_KEY,
} from '../harness';

const [appUrl, tenantId, runId, step, hangAt, nowIso] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const db = createDatabase({ connectionString: appUrl, clock: fixedClock(nowIso), max: 2 });
const rates = ratesService(ratesPortsFor(), { termsSealKey: TEST_SEAL_KEY });
const finance = createFinance(financePortsFor(rates));
const fakes = {
  reservations: new FakeReservationsLookup(),
  payments: new FakePayments(),
  inventory: new FakeInventory(),
  operations: new FakeOperations(),
  integration: new FakeIntegration(),
};
const service = createDayCloseService(buildPorts(rates, finance, fakes));
const permissions = ROLE_TEMPLATES.find((r) => r.key === 'night_auditor')?.permissions ?? [];
const ctx = {
  tenantId,
  environment: 'live' as const,
  actor: { kind: 'user' as const, userId: newId(), displayName: 'Night Auditor (process to be killed)' },
  authz: staticAuthorizer(permissions.map((permission) => ({ permission, propertyIds: 'all' as const }))),
  correlationId: newId(),
};
await service.executeRun(db, ctx, runId, {
  hooks: {
    insideItem: async (s, i) => {
      if (s === step && i === Number(hangAt)) {
        process.stdout.write(`HANGING ${s} ${i}\n`);
        await new Promise(() => {});
      }
    },
  },
});
process.stdout.write('FINISHED\n');
await db.close();
