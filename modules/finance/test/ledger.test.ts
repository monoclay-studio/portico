import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, openStay, setupOrg, startHarness, usd } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('journal', () => {
  it('posts a charge with taxes as one balanced entry and the folio is a projection of it', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId } = await openStay(h, org);
    const res = await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'FOOD',
        amount: usd(10000),
        serviceDate: '2026-11-07',
        description: 'Dinner',
        sourceRef: { type: 'pos_check', id: 'c1' },
        idempotencyKey: `pos:o1:c1:l1`,
      }),
    );
    expect(res.folioId).toBe(guestFolioId);
    // 100.00 + 10% SC + 17% TGST on 110.00 = 128.70
    const folio = await org.run((tx) => h.finance.getFolio(tx, guestFolioId));
    expect(folio.balance.amountMinor).toBe(12870);
    expect(folio.postings.map((p) => p.kind).sort()).toEqual(['charge', 'tax', 'tax']);
    expect(folio.status).toEqual({ folio: 'open', balance: 'due', invoicing: 'not_invoiced' });
    expect(folio.allowedActions.find((a) => a.action === 'settle')).toMatchObject({ enabled: false });
    await assertLedgerIntegrity(h, org);
  });

  it('keeps the journal balanced through a random sequence of postings, payments, transfers and corrections', async () => {
    const org = await setupOrg(h);
    const { stayId, guestFolioId, companyFolioId } = await openStay(h, org, { company: 'Maldivian Holidays Ltd' });
    const codes = ['FOOD', 'BEV', 'SPA', 'MINIBAR', 'DIVE', 'RETAIL', 'CXL'];
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const charges: string[] = [];
    for (let i = 0; i < 40; i++) {
      const op = rnd(5);
      if (op <= 1 || charges.length === 0) {
        const r = await org.run((tx) =>
          h.finance.postCharge(tx, {
            propertyId: org.propertyId,
            folioId: rnd(2) === 0 ? guestFolioId : (companyFolioId as string),
            chargeCode: codes[rnd(codes.length)] as string,
            amount: usd(1 + rnd(50000)),
            priceMode: rnd(2) === 0 ? 'inclusive' : 'exclusive',
            serviceDate: '2026-11-07',
            description: `charge ${i}`,
            sourceRef: { type: 'test', id: String(i) },
            idempotencyKey: `rand:${org.tenantId}:${i}`,
          }),
        );
        charges.push(r.postingIds[0] as string);
      } else if (op === 2) {
        await org.run((tx) =>
          h.finance.recordPayment(tx, {
            folioId: guestFolioId,
            amount: usd(1 + rnd(20000)),
            paymentRef: { type: 'payment', id: newId() },
            method: 'card',
            provider: 'simulator',
            idempotencyKey: `pay:${i}:${org.tenantId}`,
          }),
        );
      } else if (op === 3) {
        const postingId = charges[rnd(charges.length)] as string;
        await org
          .run((tx) => h.finance.adjustPosting(tx, { postingId, amountMinor: 1 + rnd(500), reasonCode: 'goodwill', note: 'test', idempotencyKey: `adj:${i}:${org.tenantId}` }))
          .catch((e: Error) => expect(e.message).toMatch(/at most|already been fully|corrected or moved/));
      } else {
        await org
          .run((tx) => h.finance.transferPostings(tx, { fromFolioId: guestFolioId, toFolioId: companyFolioId as string, amountMinor: 1 + rnd(3000), reason: 'split', idempotencyKey: `tr:${i}:${org.tenantId}` }))
          .catch(() => undefined);
      }
    }
    const tb = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitMinor).toBeGreaterThan(0);
    await assertLedgerIntegrity(h, org);
    const items = await org.run((tx) => h.finance.getUnbalancedItems(tx, { propertyId: org.propertyId, businessDate: '2026-11-07' }));
    expect(items.filter((i) => i.severity === 'blocking')).toEqual([]);
  });
});

describe('append-only and balance enforcement in the database', () => {
  it('refuses to update or delete posted journal lines, entries and postings', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    await org.run((tx) =>
      h.finance.postCharge(tx, { propertyId: org.propertyId, folioId: guestFolioId, chargeCode: 'SPA', amount: usd(5000), serviceDate: '2026-11-07', description: 'Massage', sourceRef: { type: 't', id: '1' }, idempotencyKey: `ao:${org.tenantId}` }),
    );
    for (const table of ['finance.journal_lines', 'finance.journal_entries', 'finance.postings']) {
      await expect(org.run((tx) => sql`update ${sql.table(table)} set tenant_id = tenant_id`.execute(tx.db))).rejects.toThrow(/permission denied|append-only/);
      await expect(org.run((tx) => sql`delete from ${sql.table(table)}`.execute(tx.db))).rejects.toThrow(/permission denied|append-only/);
    }
    // Even the table owner (bypassing grants) hits the append-only trigger.
    await expect(sql`update finance.postings set amount_minor = 1`.execute(h.t.admin.kysely)).rejects.toThrow(/append-only/);
  });

  it('rejects an unbalanced entry at commit and lines added later to an old entry', async () => {
    const org = await setupOrg(h);
    const { guestFolioId } = await openStay(h, org);
    const res = await org.run((tx) =>
      h.finance.postCharge(tx, { propertyId: org.propertyId, folioId: guestFolioId, chargeCode: 'SPA', amount: usd(5000), serviceDate: '2026-11-07', description: 'Massage', sourceRef: { type: 't', id: '1' }, idempotencyKey: `ub:${org.tenantId}` }),
    );
    const line = await sql<{ account_id: string }>`select account_id from finance.journal_lines where entry_id = ${res.entryId} limit 1`.execute(h.t.admin.kysely);
    const accountId = line.rows[0]?.account_id as string;
    // Late line on an existing entry.
    await expect(
      org.run((tx) =>
        sql`insert into finance.journal_lines (id, tenant_id, entry_id, legal_entity_id, line_no, account_id, amount_minor, currency, functional_amount_minor, functional_currency)
            values (${newId()}, ${org.tenantId}, ${res.entryId}, ${org.legalEntityId}, 99, ${accountId}, 1, 'USD', 1, 'USD')`.execute(tx.db),
      ),
    ).rejects.toThrow(/in the transaction that created it/);
    // A brand-new entry whose lines do not balance.
    await expect(
      org.run(async (tx) => {
        const id = newId();
        await sql`insert into finance.journal_entries (id, tenant_id, legal_entity_id, entry_type, business_date, occurred_at, idempotency_key, request_hash, description, actor, actor_key, correlation_id)
          values (${id}, ${org.tenantId}, ${org.legalEntityId}, 'charge', '2026-11-07', now(), ${`bad:${id}`}, 'x', 'bad', '{}', 'x', 'x')`.execute(tx.db);
        for (const amt of [100, -99]) {
          await sql`insert into finance.journal_lines (id, tenant_id, entry_id, legal_entity_id, line_no, account_id, amount_minor, currency, functional_amount_minor, functional_currency)
            values (${newId()}, ${org.tenantId}, ${id}, ${org.legalEntityId}, ${amt > 0 ? 1 : 2}, ${accountId}, ${amt}, 'USD', ${amt}, 'USD')`.execute(tx.db);
        }
      }),
    ).rejects.toThrow(/unbalanced/);
  });
});
