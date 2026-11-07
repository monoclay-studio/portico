/**
 * Demo seed: in a demo organization's guesthouse property, a migration from the fictional "Coral Nest" spreadsheet
 * pack is staged (uploaded, not yet run) so a visitor can press "Move to Portico" and watch it rehearse.
 */
import type { TxContext } from '@portico/db';
import { kindFromName, mapColumns } from './domain/columns';
import { parseCsv } from './domain/csv';
import { buildPack } from './domain/pack';
import type { MigrationDeps } from './service/context';
import { storeExtract } from './service/extract';
import { createJob } from './service/jobs';
import { sampleGuesthouseFiles } from './sources/templates';

export function createMigrationDemoSeed(deps: () => MigrationDeps) {
  return {
    name: 'migration',
    async run(tx: TxContext, org: { properties: ReadonlyArray<{ id: string; profile: string }> }) {
      if (tx.environment !== 'demo') return;
      const property = org.properties.find((p) => p.profile === 'guesthouse');
      if (!property) return;
      const d = deps();
      const facts = await d.ports.platform.getProperty(tx, property.id);
      const job = await createJob(tx, d, {
        propertyId: property.id,
        sourceAdapter: 'portico.pack.v1',
        sourceSystem: 'Coral Nest spreadsheets (sample)',
      });
      const tables = sampleGuesthouseFiles(facts.businessDate).map((f) => {
        const table = parseCsv(f.content);
        const kind = kindFromName(f.name) ?? 'reservations';
        return {
          name: f.name,
          kind,
          spreadsheet: false,
          headers: table.headers,
          rows: table.rows,
          columns: mapColumns(kind, table.headers).columns,
          checksum: '',
        };
      });
      // Validate the pack builds (fails the seed loudly if the sample drifts from the templates).
      buildPack(
        tables.map((t) => ({ ...t, table: { headers: t.headers, rows: t.rows, delimiter: ',' } })),
        { defaultCurrency: facts.baseCurrency },
      );
      await storeExtract(tx, job, { kind: 'initial', source: { type: 'tables', tables } });
    },
  };
}
