import { describe, expect, it } from 'vitest';
import { effectOf } from '../domain/outbound-policy';
import { createConnectorRegistry, PmsSimulatorHub } from './catalogue';

const registry = createConnectorRegistry({ pmsSimulator: new PmsSimulatorHub() });

describe('connector registry invariants (catalogue honesty)', () => {
  it('every declared write operation has an explicit effect class', () => {
    for (const { definition: d } of registry.list()) {
      for (const w of d.workflows) {
        for (const op of w.operations.filter((o) => o === 'create' || o === 'update')) {
          if (w.status === 'unverified') continue; // planned: not built, cannot send
          expect(w.effects[op], `${d.key}/${w.workflow}/${op}`).toBeDefined();
        }
      }
    }
  });
  it('reservation changes are inventory-class, never standard (INT-R19)', () => {
    const sim = registry
      .get('pms.simulator')
      ?.definition.workflows.find((w) => w.workflow === 'reservations');
    expect(sim?.effects).toMatchObject({
      create: 'inventory',
      update: 'inventory',
      cancel: 'inventory_reopen',
    });
  });
  it('nothing claims more than R3 without sandbox evidence; simulators are simulated; files are file-based', () => {
    for (const { definition: d, adapter } of registry.list()) {
      expect(['R1', 'R2', 'R3']).toContain(d.implementation.level);
      if (d.isSimulator) expect(d.provenance).toBe('simulated');
      if (d.fileBased) {
        expect(d.provenance).toBe('file');
        expect(d.workflows.every((w) => w.sync === 'file')).toBe(true);
      }
      if (!adapter && d.setupPath !== 'webhook_subscriptions') {
        expect(d.setupPath).toBe('not_available');
        expect(d.workflows.every((w) => w.status === 'unverified')).toBe(true);
      }
      expect(d.provenance).not.toBe('live');
    }
  });
});

describe('effect classes fail closed (PROBE-9)', () => {
  it('an undeclared operation is money-class on money domains and inventory-class elsewhere', () => {
    expect(effectOf({ create: 'money' }, 'post', 'charges')).toBe('money');
    expect(effectOf({}, 'refund', 'payments')).toBe('money');
    expect(effectOf({}, 'export', 'accounting')).toBe('money');
    expect(effectOf({ cancel: 'inventory_reopen' }, 'create', 'reservations')).toBe('inventory');
    expect(effectOf({}, 'update', 'roomStatus')).toBe('inventory');
    expect(effectOf({ update: 'standard' }, 'update', 'roomStatus')).toBe('standard');
  });
});
