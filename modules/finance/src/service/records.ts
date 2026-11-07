import type { TxContext } from '@portico/db';
import type { RecordAction, RecordIssue, RecordLink, RecordOwner } from '@portico/kernel';
import { db } from './support';

/**
 * Server-computed "what can I do next / what is wrong" for finance records (universal record contract).
 * Every disabled action says why in plain language; permissions are evaluated for the current actor.
 */
const action = (
  tx: TxContext,
  a: {
    action: string;
    label: string;
    permission: string;
    propertyId?: string | null;
    blockedBy?: string | null;
    previewRequired?: boolean;
  },
): RecordAction => {
  const allowed = tx.authz.can(a.permission, a.propertyId ? { propertyId: a.propertyId } : undefined);
  const reason = !allowed
    ? `You do not have permission to do this (${a.permission}).`
    : (a.blockedBy ?? undefined);
  return {
    action: a.action,
    label: a.label,
    enabled: allowed && !a.blockedBy,
    ...(reason ? { reason } : {}),
    ...(a.previewRequired ? { previewRequired: true } : {}),
  };
};

export type InvoicingState = 'nothing_to_invoice' | 'not_invoiced' | 'partly_invoiced' | 'invoiced';

export function invoicingState(invoiced: number, uninvoicedCharges: number): InvoicingState {
  if (uninvoicedCharges === 0) return invoiced > 0 ? 'invoiced' : 'nothing_to_invoice';
  return invoiced > 0 ? 'partly_invoiced' : 'not_invoiced';
}

export async function folioInvoicing(
  tx: TxContext,
  folioId: string,
): Promise<{ invoiced: number; uninvoicedCharges: number }> {
  const rows = await db(tx)
    .selectFrom('finance.postings as p')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .select(['l.document_id', 'p.kind'])
    .where('p.folio_id', '=', folioId)
    .execute();
  const charges = [
    'charge',
    'tax',
    'adjustment',
    'transfer_in',
    'transfer_out',
    'paid_out',
    'opening_balance',
  ];
  return {
    invoiced: rows.filter((r) => r.document_id).length,
    uninvoicedCharges: rows.filter((r) => !r.document_id && charges.includes(r.kind)).length,
  };
}

export async function folioRecord(
  tx: TxContext,
  f: {
    id: string;
    propertyId: string;
    status: 'open' | 'settled' | 'closed' | 'voided';
    balanceMinor: number;
    currency: string;
    owner: { type: string; id: string };
    payer: { type: string; id?: string; name: string };
    supplementaryOf: string | null;
    postDeparture: boolean;
    reopenedReason: string | null;
    postingCount: number;
    invoicing: InvoicingState;
  },
): Promise<{
  allowedActions: RecordAction[];
  issues: RecordIssue[];
  links: RecordLink[];
  owner?: RecordOwner;
}> {
  const p = f.propertyId;
  const voided = f.status === 'voided' ? 'This folio was voided.' : null;
  const closed =
    f.status === 'closed'
      ? 'This folio is closed; new charges go to a supplementary folio automatically.'
      : null;
  const fmt = `${f.balanceMinor} ${f.currency} (minor units)`;
  const allowedActions: RecordAction[] = [
    action(tx, {
      action: 'postCharge',
      label: 'Post charge',
      permission: 'finance.posting.create',
      propertyId: p,
      blockedBy: voided,
    }),
    action(tx, {
      action: 'collectPayment',
      label: 'Take payment',
      permission: 'finance.cashier.operate',
      propertyId: p,
      blockedBy: voided ?? (f.balanceMinor <= 0 ? 'Nothing is due on this folio.' : null),
    }),
    action(tx, {
      action: 'transferPostings',
      label: 'Transfer to another folio',
      permission: 'finance.posting.transfer',
      propertyId: p,
      blockedBy:
        voided ?? closed ?? (f.postingCount === 0 ? 'This folio has no postings to transfer.' : null),
      previewRequired: true,
    }),
    action(tx, {
      action: 'correctPosting',
      label: 'Correct a charge',
      permission: 'finance.posting.correct',
      propertyId: p,
      blockedBy: voided ?? (f.postingCount === 0 ? 'There are no charges to correct.' : null),
      previewRequired: true,
    }),
    action(tx, {
      action: 'issueInvoice',
      label: 'Issue invoice',
      permission: 'finance.invoice.issue',
      propertyId: p,
      blockedBy:
        voided ??
        (f.invoicing === 'invoiced' || f.invoicing === 'nothing_to_invoice'
          ? 'All charges on this folio are already invoiced.'
          : null),
      previewRequired: true,
    }),
    action(tx, {
      action: 'settle',
      label: 'Settle folio',
      permission: 'finance.folio.manage',
      propertyId: p,
      blockedBy:
        f.status !== 'open'
          ? `The folio is ${f.status}.`
          : f.balanceMinor !== 0
            ? `A balance of ${fmt} remains. Take a payment or transfer it first.`
            : null,
    }),
    action(tx, {
      action: 'transferToReceivables',
      label: 'Direct bill to company account',
      permission: 'finance.folio.settleToReceivables',
      propertyId: p,
      blockedBy:
        f.status !== 'open'
          ? `The folio is ${f.status}.`
          : f.balanceMinor <= 0
            ? 'Nothing is due on this folio.'
            : null,
      previewRequired: true,
    }),
    action(tx, {
      action: 'close',
      label: 'Close folio',
      permission: 'finance.folio.manage',
      propertyId: p,
      blockedBy: f.status !== 'settled' ? 'Only a settled folio can be closed.' : null,
    }),
    action(tx, {
      action: 'void',
      label: 'Void folio',
      permission: 'finance.folio.manage',
      propertyId: p,
      blockedBy:
        f.status !== 'open' || f.postingCount > 0
          ? 'Only an open folio without postings can be voided.'
          : null,
    }),
  ];
  const issues: RecordIssue[] = [];
  const exceptions = await db(tx)
    .selectFrom('finance.exceptions')
    .select(['kind', 'severity', 'message', 'created_at'])
    .where('ref_type', '=', 'folio')
    .where('ref_id', '=', f.id)
    .where('status', '=', 'open')
    .execute();
  for (const e of exceptions) {
    issues.push({
      code: e.kind,
      severity: e.severity === 'urgent' ? 'blocking' : 'warning',
      message: e.message,
      since: new Date(e.created_at).toISOString(),
    });
  }
  const departed = await db(tx)
    .selectFrom('finance.owner_departures')
    .select('departed_on')
    .where('owner_type', '=', f.owner.type)
    .where('owner_id', '=', f.owner.id)
    .executeTakeFirst();
  if (departed && f.balanceMinor > 0 && f.status !== 'voided') {
    issues.push({
      code: 'departed_with_balance',
      severity: 'warning',
      message: `The guest departed on ${departed.departed_on} with ${fmt} still due.`,
      since: departed.departed_on,
    });
  }
  if (f.balanceMinor !== 0 && (f.status === 'settled' || f.status === 'closed')) {
    issues.push({
      code: 'settled_with_balance',
      severity: 'blocking',
      message: 'This folio is settled but shows a balance. Report this to finance.',
    });
  }
  const unverified = await db(tx)
    .selectFrom('finance.postings')
    .select(['id'])
    .where('folio_id', '=', f.id)
    .where('payment_verification', '=', 'recorded_unverified')
    .execute();
  if (unverified.length) {
    issues.push({
      code: 'payments_awaiting_verification',
      severity: 'info',
      message: `${unverified.length} recorded payment(s) on this folio are awaiting verification against the bank or acquirer statement.`,
    });
  }
  if (f.reopenedReason)
    issues.push({
      code: 'reopened',
      severity: 'info',
      message: `Reopened (${f.reopenedReason.replace('_', ' ')}).`,
    });
  const links: RecordLink[] = [{ rel: 'owner', type: f.owner.type, id: f.owner.id }];
  if (f.payer.id)
    links.push({
      rel: 'payer',
      type: f.payer.type === 'guest' ? 'guest_profile' : 'company',
      id: f.payer.id,
      title: f.payer.name,
    });
  if (f.supplementaryOf) links.push({ rel: 'supplementary_of', type: 'folio', id: f.supplementaryOf });
  const docs = await db(tx)
    .selectFrom('finance.fiscal_documents')
    .select(['id', 'document_number'])
    .where('folio_id', '=', f.id)
    .orderBy('chain_position')
    .execute();
  for (const d of docs)
    links.push({ rel: 'document', type: 'fiscal_document', id: d.id, title: d.document_number });
  return { allowedActions, issues, links };
}

export function documentRecord(
  tx: TxContext,
  d: {
    id: string;
    propertyId: string;
    kind: string;
    status: string;
    folioId: string;
    originalDocumentId: string | null;
    snapshot: Record<string, unknown>;
    creditNotes: Array<{ id: string; number: string }>;
  },
): { allowedActions: RecordAction[]; issues: RecordIssue[]; links: RecordLink[] } {
  const allowedActions: RecordAction[] = [
    action(tx, {
      action: 'downloadPdf',
      label: 'Download PDF',
      permission: 'finance.folio.read',
      propertyId: d.propertyId,
    }),
  ];
  if (d.kind === 'invoice') {
    allowedActions.push(
      action(tx, {
        action: 'issueCreditNote',
        label: 'Issue credit note',
        permission: 'finance.creditNote.issue',
        propertyId: d.propertyId,
        blockedBy: d.status === 'credited' ? 'This invoice is already fully credited.' : null,
        previewRequired: true,
      }),
    );
  }
  const issues: RecordIssue[] = [];
  if (d.snapshot.sample)
    issues.push({
      code: 'sample_document',
      severity: 'info',
      message: 'Issued outside the live environment — a sample, not a valid tax document.',
    });
  const pack = d.snapshot.taxRulePack as { verified?: boolean } | undefined;
  if (pack && pack.verified === false)
    issues.push({
      code: 'unverified_tax_rules',
      severity: 'warning',
      message: 'Issued with tax rules that are not yet verified by a tax adviser.',
    });
  for (const w of (d.snapshot.particularsWarnings as string[] | undefined) ?? [])
    issues.push({ code: 'invoice_particulars', severity: 'warning', message: w });
  const links: RecordLink[] = [{ rel: 'folio', type: 'folio', id: d.folioId }];
  if (d.originalDocumentId) links.push({ rel: 'credits', type: 'fiscal_document', id: d.originalDocumentId });
  for (const c of d.creditNotes)
    links.push({ rel: 'credit_note', type: 'fiscal_document', id: c.id, title: c.number });
  return { allowedActions, issues, links };
}

export function receivablesRecord(
  tx: TxContext,
  a: {
    id: string;
    companyId: string;
    kind: string;
    name: string;
    status: string;
    overLimit: boolean;
    balanceMinor: number;
    limitMinor: number | null;
    currency: string;
    over90Minor: number;
  },
): { allowedActions: RecordAction[]; issues: RecordIssue[]; links: RecordLink[] } {
  const allowedActions: RecordAction[] = [
    action(tx, {
      action: 'recordPayment',
      label: 'Record payment',
      permission: 'finance.receivables.manage',
      blockedBy: a.status === 'closed' ? 'The account is closed.' : null,
    }),
    action(tx, {
      action: 'allocatePayment',
      label: 'Allocate payment to invoices',
      permission: 'finance.receivables.manage',
    }),
    action(tx, {
      action: a.status === 'on_hold' ? 'reactivate' : 'putOnHold',
      label: a.status === 'on_hold' ? 'Reactivate account' : 'Put on hold',
      permission: 'finance.receivables.manage',
      blockedBy: a.status === 'closed' ? 'The account is closed.' : null,
    }),
    action(tx, {
      action: 'close',
      label: 'Close account',
      permission: 'finance.receivables.manage',
      blockedBy:
        a.balanceMinor !== 0
          ? 'Only an account with zero balance can be closed.'
          : a.status === 'closed'
            ? 'Already closed.'
            : null,
    }),
  ];
  const issues: RecordIssue[] = [];
  if (a.overLimit)
    issues.push({
      code: 'over_credit_limit',
      severity: 'warning',
      message: `Balance ${a.balanceMinor} exceeds the credit limit of ${a.limitMinor} ${a.currency} (minor units).`,
    });
  if (a.over90Minor > 0)
    issues.push({
      code: 'overdue_over_90_days',
      severity: 'warning',
      message: `${a.over90Minor} ${a.currency} (minor units) is more than 90 days overdue.`,
    });
  if (a.status === 'on_hold')
    issues.push({
      code: 'on_hold',
      severity: 'info',
      message: 'On hold: new direct-bill transfers are refused.',
    });
  return {
    allowedActions,
    issues,
    links: [{ rel: a.kind, type: 'company', id: a.companyId, title: a.name }],
  };
}

export function cashierRecord(
  tx: TxContext,
  s: {
    propertyId: string;
    userKey: string;
    mine: boolean;
    cashierName: string;
    status: string;
    openedBusinessDate: string;
    businessDate: string | null;
    variance: Record<string, number> | null;
  },
): { allowedActions: RecordAction[]; issues: RecordIssue[]; links: RecordLink[]; owner: RecordOwner } {
  const mine = s.mine;
  const closePerm = mine ? 'finance.cashier.operate' : 'finance.cashier.review';
  const allowedActions: RecordAction[] = [
    action(tx, {
      action: 'close',
      label: 'Count and close',
      permission: closePerm,
      propertyId: s.propertyId,
      blockedBy: s.status !== 'open' ? 'This session is closed.' : null,
    }),
    action(tx, {
      action: 'paidOut',
      label: 'Pay out cash',
      permission: 'finance.cashier.paidOut',
      propertyId: s.propertyId,
      blockedBy:
        s.status !== 'open'
          ? 'This session is closed.'
          : !mine
            ? 'Paid-outs come from your own session.'
            : null,
    }),
  ];
  const issues: RecordIssue[] = [];
  if (s.status === 'open' && s.businessDate && s.openedBusinessDate < s.businessDate) {
    issues.push({
      code: 'session_open_across_business_dates',
      severity: 'warning',
      message: `Open since business date ${s.openedBusinessDate}. Close it before Day Close.`,
      since: s.openedBusinessDate,
    });
  }
  for (const [c, v] of Object.entries(s.variance ?? {})) {
    if (v !== 0)
      issues.push({
        code: v > 0 ? 'cash_over' : 'cash_short',
        severity: 'warning',
        message: `${c} ${v > 0 ? 'over' : 'short'} by ${Math.abs(v)} (minor units) at close.`,
      });
  }
  const [kind, id] = s.userKey.split(':');
  return {
    allowedActions,
    issues,
    links: [],
    owner: { kind: 'user', id: kind === 'user' ? (id ?? s.userKey) : s.userKey, name: s.cashierName },
  };
}
