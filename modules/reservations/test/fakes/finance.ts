import { sql, type TxContext } from '@portico/db';
import { type EntityRef, type Money, money, NotFoundError, newId } from '@portico/kernel';
import type { BillingRuleInput, FinancePort, FolioSummary, PayerRef } from '../../src/ports';

const GROUP: Record<string, string> = {
  ROOM: 'room',
  PKG: 'package',
  CANCEL_FEE: 'penalty',
  NO_SHOW: 'penalty',
  EARLY_DEPARTURE: 'penalty',
  EARLY_CHECK_IN: 'fee',
  LATE_CHECK_OUT: 'fee',
  MINIBAR: 'minibar',
  SPA: 'spa',
};

/**
 * Fake finance (FinancePort), Postgres-backed in a test-only schema so postings roll back with the command and
 * idempotency keys are enforced by a UNIQUE constraint (never a duplicate charge). Billing rules route by charge
 * code group and service date; unmatched charges go to the owner's default folio (first opened).
 */
export class FakeFinance implements FinancePort {
  async openFolio(
    tx: TxContext,
    input: { propertyId: string; owner: EntityRef; payer: PayerRef; label?: string },
  ) {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from fake_finance.folios
      where owner_type = ${input.owner.type} and owner_id = ${input.owner.id}`.execute(tx.db);
    const id = newId();
    await sql`insert into fake_finance.folios values (${id}, ${tx.tenantId}, ${input.propertyId}, ${input.owner.type}, ${input.owner.id},
      ${input.payer.type}, ${input.payer.id}, ${input.label ?? null}, ${(rows[0]?.n ?? 0) === 0}, 'open')`.execute(
      tx.db,
    );
    return { folioId: id };
  }

  async postCharge(tx: TxContext, input: Parameters<FinancePort['postCharge']>[1]) {
    const dup = await sql<{
      id: string;
      folio_id: string;
    }>`select id, folio_id from fake_finance.postings where idempotency_key = ${input.idempotencyKey}`.execute(
      tx.db,
    );
    if (dup.rows[0]) return { postingIds: [dup.rows[0].id], folioId: dup.rows[0].folio_id };
    let folioId = input.folioId ?? null;
    if (!folioId && input.target) {
      const group = GROUP[input.chargeCode] ?? 'misc';
      const rule = await sql<{
        destination_folio_id: string;
      }>`select destination_folio_id from fake_finance.billing_rules
        where owner_type = ${input.target.type} and owner_id = ${input.target.id} and ${group} = any(charge_code_groups)
          and (from_date is null or from_date <= ${input.serviceDate}::date) and (to_date is null or to_date > ${input.serviceDate}::date)`.execute(
        tx.db,
      );
      folioId = rule.rows[0]?.destination_folio_id ?? null;
      if (!folioId) {
        const def = await sql<{
          id: string;
        }>`select id from fake_finance.folios where owner_type = ${input.target.type}
          and owner_id = ${input.target.id} and is_default`.execute(tx.db);
        folioId =
          def.rows[0]?.id ??
          (
            await this.openFolio(tx, {
              propertyId: input.propertyId,
              owner: input.target,
              payer: { type: 'house', id: input.target.id },
            })
          ).folioId;
      }
    }
    if (!folioId) throw new NotFoundError('folio');
    const id = newId();
    const amount = input.amount.amountMinor * (input.quantity ?? 1);
    await sql`insert into fake_finance.postings values (${id}, ${tx.tenantId}, ${folioId}, 'charge', ${input.chargeCode}, ${amount},
      ${input.amount.currency}, ${input.serviceDate}::date, ${input.description}, ${input.sourceRef.type}, ${input.sourceRef.id}, ${input.idempotencyKey})`.execute(
      tx.db,
    );
    await sql`update fake_finance.folios set status = 'open' where id = ${folioId}`.execute(tx.db);
    return { postingIds: [id], folioId };
  }

  async recordPayment(tx: TxContext, input: { folioId: string; amount: Money; idempotencyKey: string }) {
    await sql`insert into fake_finance.postings values (${newId()}, ${tx.tenantId}, ${input.folioId}, 'payment', null, ${-input.amount.amountMinor},
      ${input.amount.currency}, null, 'payment', null, null, ${input.idempotencyKey}) on conflict do nothing`.execute(
      tx.db,
    );
  }

  async recordDeposit(
    tx: TxContext,
    input: { bookingId: string; amount: Money; paymentRef: EntityRef; idempotencyKey: string },
  ) {
    await sql`insert into fake_finance.deposits values (${newId()}, ${tx.tenantId}, ${input.bookingId}, ${input.amount.amountMinor},
      ${input.amount.currency}, null, ${input.idempotencyKey}) on conflict do nothing`.execute(tx.db);
  }

  async applyDeposits(tx: TxContext, input: { bookingId: string; toFolioId: string }) {
    const { rows } = await sql<{
      id: string;
      amount_minor: number;
      currency: string;
    }>`update fake_finance.deposits set applied_to_folio = ${input.toFolioId}
      where booking_id = ${input.bookingId} and applied_to_folio is null returning id, amount_minor, currency`.execute(
      tx.db,
    );
    let total = 0;
    for (const d of rows) {
      total += d.amount_minor;
      await sql`insert into fake_finance.postings values (${newId()}, ${tx.tenantId}, ${input.toFolioId}, 'deposit_application', null,
        ${-d.amount_minor}, ${d.currency}, null, 'deposit applied', 'deposit', ${d.id}, ${`deposit-apply:${d.id}`})`.execute(
        tx.db,
      );
    }
    return { applied: money(total, rows[0]?.currency ?? 'USD') };
  }

  async getFolioBalance(tx: TxContext, folioId: string) {
    const { rows } = await sql<{
      balance: number;
      currency: string | null;
      status: string;
    }>`select coalesce(sum(p.amount_minor), 0)::bigint as balance,
      max(p.currency) as currency, f.status from fake_finance.folios f left join fake_finance.postings p on p.folio_id = f.id
      where f.id = ${folioId} group by f.status`.execute(tx.db);
    const r = rows[0];
    if (!r) throw new NotFoundError('folio', folioId);
    return { folioId, balance: money(Number(r.balance), r.currency ?? 'USD'), status: r.status };
  }

  async listFolios(tx: TxContext, input: { owner: EntityRef }): Promise<FolioSummary[]> {
    const { rows } = await sql<{
      id: string;
      payer_type: string;
      payer_id: string;
      label: string | null;
      is_default: boolean;
      status: string;
    }>`
      select id, payer_type, payer_id, label, is_default, status from fake_finance.folios
       where owner_type = ${input.owner.type} and owner_id = ${input.owner.id} order by is_default desc, id`.execute(
      tx.db,
    );
    const out: FolioSummary[] = [];
    for (const r of rows) {
      out.push({
        folioId: r.id,
        owner: input.owner,
        payer: { type: r.payer_type as PayerRef['type'], id: r.payer_id },
        ...(r.label ? { label: r.label } : {}),
        isDefault: r.is_default,
        status: r.status as 'open' | 'settled',
        balance: (await this.getFolioBalance(tx, r.id)).balance,
      });
    }
    return out;
  }

  async setBillingRules(tx: TxContext, input: { owner: EntityRef; rules: BillingRuleInput[] }) {
    const ids: string[] = [];
    for (const r of input.rules) {
      const id = newId();
      ids.push(id);
      await sql`insert into fake_finance.billing_rules values (${id}, ${tx.tenantId}, ${input.owner.type}, ${input.owner.id},
        ${r.destinationFolioId}, ${r.chargeCodeGroups}, ${r.serviceDates?.from ?? null}, ${r.serviceDates?.to ?? null})`.execute(
        tx.db,
      );
    }
    return { ruleIds: ids };
  }

  async getDepositBalance(tx: TxContext, input: { bookingId: string }) {
    const { rows } = await sql<{
      total: number;
    }>`select coalesce(sum(amount_minor), 0)::bigint as total from fake_finance.deposits
      where booking_id = ${input.bookingId} and applied_to_folio is null`.execute(tx.db);
    return money(Number(rows[0]?.total ?? 0), 'USD');
  }

  // ── inspection ──
  async postings(
    tx: TxContext,
  ): Promise<
    Array<{ folioId: string; chargeCode: string | null; amountMinor: number; key: string; kind: string }>
  > {
    const { rows } = await sql<{
      folio_id: string;
      charge_code: string | null;
      amount_minor: number;
      idempotency_key: string;
      kind: string;
    }>`
      select folio_id, charge_code, amount_minor, idempotency_key, kind from fake_finance.postings order by id`.execute(
      tx.db,
    );
    return rows.map((r) => ({
      folioId: r.folio_id,
      chargeCode: r.charge_code,
      amountMinor: Number(r.amount_minor),
      key: r.idempotency_key,
      kind: r.kind,
    }));
  }
}
