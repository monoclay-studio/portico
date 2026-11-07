/**
 * Universal record contract for payments records (CLAUDE.md §4.17, domain-map § Universal record contract):
 * `status` per family, server-computed `allowedActions` with plain-language reasons, `issues`, `owner`, `links`
 * and `provenance`. Permissions are evaluated here so the UI, API, integrations and AI see the same truth.
 */
import { type TxContext, typed } from '@portico/db';
import type {
  Authorizer,
  Provenance,
  RecordAction,
  RecordIssue,
  RecordLink,
  RecordOwner,
} from '@portico/kernel';
import { capturableMinor, refundableMinor } from '../domain/states';
import type { PaymentsDB } from '../tables';
import type { AuthorizationRow, ExceptionRow, PaymentRow, RefundRow, RequestRow } from './shared';

const db = (tx: TxContext) => typed<PaymentsDB>(tx.db);

export interface RecordParts {
  status: Record<string, string>;
  allowedActions: RecordAction[];
  issues: RecordIssue[];
  owner?: RecordOwner;
  links: RecordLink[];
  provenance?: Provenance;
}

export interface RecordContext {
  authz: Authorizer;
  /** Open payment exceptions by `${refType}:${refId}`. */
  issues: Map<string, RecordIssue[]>;
}

const OWNER_NAMES: Record<string, string> = {
  finance: 'Finance',
  front_office_manager: 'Front office manager',
  reservations: 'Reservations',
};

export function exceptionOwner(role: string): RecordOwner {
  return { kind: 'department', id: role, name: OWNER_NAMES[role] ?? role.replace(/_/g, ' ') };
}

/** Load open exceptions for the given records in one query. */
export async function recordContext(
  tx: TxContext,
  refs: ReadonlyArray<{ type: string; id: string }>,
): Promise<RecordContext> {
  const issues = new Map<string, RecordIssue[]>();
  if (refs.length) {
    const rows = await db(tx)
      .selectFrom('payments.exceptions')
      .select(['kind', 'severity', 'problem', 'owner_role', 'ref_type', 'ref_id', 'created_at'])
      .where('status', '=', 'open')
      .where(
        'ref_id',
        'in',
        refs.map((r) => r.id),
      )
      .execute();
    for (const r of rows) {
      const key = `${r.ref_type}:${r.ref_id}`;
      const list = issues.get(key) ?? [];
      list.push({
        code: r.kind,
        severity: r.severity === 'urgent' ? 'blocking' : 'warning',
        message: r.problem,
        owner: exceptionOwner(r.owner_role),
        since: new Date(r.created_at).toISOString(),
      });
      issues.set(key, list);
    }
  }
  return { authz: tx.authz, issues };
}

function provenanceOf(mode: string): Provenance {
  if (mode === 'simulate' || mode === 'sandbox') return 'simulated';
  if (mode === 'recorded') return 'external';
  return 'live';
}

function action(
  key: string,
  label: string,
  enabled: boolean,
  reason?: string,
  previewRequired?: boolean,
): RecordAction {
  return {
    action: key,
    label,
    enabled,
    ...(!enabled && reason ? { reason } : {}),
    ...(previewRequired ? { previewRequired } : {}),
  };
}

function noPermission(permission: string): string {
  return `You do not have permission for this (${permission}). Ask a manager if you need it.`;
}

function refLink(type: string, id: string): RecordLink {
  const rel = type === 'folio' ? 'folio' : type === 'booking' ? 'booking' : type;
  return { rel, type, id };
}

export function paymentRecord(p: PaymentRow, rc: RecordContext): RecordParts {
  const can = (perm: string) => rc.authz.can(perm, { propertyId: p.property_id });
  const refundable = refundableMinor({
    amountMinor: p.amount_minor,
    adjustedMinor: p.adjusted_minor,
    refundedMinor: p.refunded_minor,
    refundReservedMinor: p.refund_reserved_minor,
  });
  const pending = p.status === 'processing' || p.status === 'pending_verification';
  const recorded = p.mode === 'recorded';
  const collected =
    p.status === 'succeeded' || p.status === 'recorded_unverified' || p.status === 'recorded_verified';
  const refundReason = !collected
    ? pending
      ? 'The payment is still being verified with the provider; a refund is possible once it is confirmed.'
      : 'Nothing was collected, so there is nothing to refund.'
    : refundable <= 0
      ? 'This payment has already been fully refunded (or a refund is in progress).'
      : !can('payments.payment.refund')
        ? noPermission('payments.payment.refund')
        : undefined;
  const actions: RecordAction[] = [
    action(
      'checkStatus',
      'Check with provider now',
      pending,
      pending ? undefined : 'The outcome is already final; there is nothing to verify.',
    ),
  ];
  if (p.status === 'awaiting_receipt') {
    const confirmReason = can('payments.bankTransfer.confirm')
      ? undefined
      : noPermission('payments.bankTransfer.confirm');
    actions.push(
      action(
        'confirmReceipt',
        'Confirm receipt (seen on the bank statement)',
        !confirmReason,
        confirmReason,
        true,
      ),
      action(
        'cancelExpected',
        'Cancel — the transfer will not come',
        can('payments.externalRecord.create'),
        noPermission('payments.externalRecord.create'),
      ),
    );
  } else if (recorded) {
    actions.push(
      action('recordRefund', 'Record a refund made on the terminal', !refundReason, refundReason, true),
      action(
        'adjust',
        'Record a correction',
        can('payments.reconciliation.manage'),
        noPermission('payments.reconciliation.manage'),
        true,
      ),
    );
  } else {
    actions.push(action('refund', 'Refund', !refundReason, refundReason, true));
  }
  const issues: RecordIssue[] = [];
  if (p.status === 'pending_verification') {
    issues.push({
      code: 'pending_verification',
      severity: 'warning',
      message: 'Outcome unknown — being verified with the payment provider. Do not charge again.',
      since: new Date(p.updated_at).toISOString(),
    });
  }
  if (p.status === 'awaiting_receipt') {
    issues.push({
      code: 'awaiting_receipt',
      severity: 'info',
      message: 'Bank transfer expected — not on the bill until receipt is confirmed.',
    });
  }
  if (p.status === 'recorded_unverified') {
    issues.push({
      code: 'recorded_unverified',
      severity: 'info',
      message: 'Recorded by staff; not yet matched to the settlement or bank statement.',
    });
  }
  if (p.ledger_status === 'failed' || (p.ledger_status === 'pending' && collected)) {
    issues.push({
      code: 'ledger_not_posted',
      severity: 'blocking',
      message:
        'Collected but not yet shown on the bill (ledger posting pending/failed). Portico retries automatically.',
    });
  }
  issues.push(...(rc.issues.get(`payment:${p.id}`) ?? []));
  const links: RecordLink[] = [refLink(p.ref_type, p.ref_id)];
  if (p.account_id) links.push({ rel: 'paymentAccount', type: 'payment_account', id: p.account_id });
  if (p.authorization_id) links.push({ rel: 'authorization', type: 'authorization', id: p.authorization_id });
  if (p.payment_request_id)
    links.push({ rel: 'paymentRequest', type: 'payment_request', id: p.payment_request_id });
  if (p.virtual_card_id) links.push({ rel: 'virtualCard', type: 'virtual_card', id: p.virtual_card_id });
  if (p.payout_id) links.push({ rel: 'payout', type: 'payout', id: p.payout_id });
  if (p.method_id) links.push({ rel: 'paymentMethod', type: 'payment_method', id: p.method_id });
  return {
    status: {
      payment: p.status,
      ledger: p.ledger_status,
      ...(p.payout_id ? { settlement: 'in_payout' } : {}),
    },
    allowedActions: actions,
    issues,
    links,
    provenance: provenanceOf(p.mode),
  };
}

export function authorizationRecord(
  a: AuthorizationRow,
  rc: RecordContext,
  capabilities: readonly string[],
): RecordParts {
  const can = (perm: string) => rc.authz.can(perm, { propertyId: a.property_id });
  const open = a.status === 'authorized' || a.status === 'partially_captured';
  const capturable = capturableMinor({
    amountMinor: a.amount_minor,
    capturedMinor: a.captured_minor,
    captureReservedMinor: a.capture_reserved_minor,
  });
  const pending = a.status === 'processing' || a.status === 'pending_verification';
  const notOpenReason = pending
    ? 'The hold is still being verified with the provider.'
    : a.status === 'expired'
      ? 'The hold has expired — take a new authorization or payment.'
      : a.status === 'captured'
        ? 'The hold has already been fully collected.'
        : a.status === 'voided'
          ? 'The hold was released.'
          : a.status === 'failed'
            ? 'The hold was declined; no funds are held.'
            : undefined;
  const collectPerm = can('payments.payment.collect') ? undefined : noPermission('payments.payment.collect');
  const recorded = a.mode === 'recorded';
  const actions: RecordAction[] = [];
  if (recorded) {
    const reason = notOpenReason ?? collectPerm;
    actions.push(
      action('recordTerminalPayment', 'Record the payment taken on the terminal', !reason, reason, true),
      action('release', 'Mark as released on the terminal', !reason, reason, true),
    );
  } else {
    const captureReason =
      notOpenReason ??
      (capturable <= 0 ? 'A collection from this hold is already in progress.' : collectPerm);
    const incrementReason =
      notOpenReason ??
      (capabilities.includes('incrementalAuthorize')
        ? collectPerm
        : 'The provider of this account does not support increasing a hold.');
    const voidReason =
      notOpenReason ??
      (a.capture_reserved_minor > 0
        ? 'A collection is in progress; wait for it before releasing the rest.'
        : collectPerm);
    actions.push(
      action('capture', 'Collect', !captureReason, captureReason, true),
      action('increment', 'Increase hold', !incrementReason, incrementReason, true),
      action('void', 'Release hold', !voidReason, voidReason, true),
      action(
        'checkStatus',
        'Check with provider now',
        pending,
        pending ? undefined : 'The hold is not pending verification.',
      ),
    );
  }
  const issues: RecordIssue[] = [];
  if (a.status === 'pending_verification') {
    issues.push({
      code: 'pending_verification',
      severity: 'warning',
      message: 'Outcome unknown — being verified with the provider. Do not request another hold.',
    });
  }
  if (open && a.expires_at) {
    issues.push({
      code: 'hold_expires',
      severity: 'info',
      message: `The hold is valid until ${new Date(a.expires_at).toISOString()}; it is not a payment.`,
    });
  }
  issues.push(...(rc.issues.get(`authorization:${a.id}`) ?? []));
  const links: RecordLink[] = [
    refLink(a.ref_type, a.ref_id),
    { rel: 'paymentAccount', type: 'payment_account', id: a.account_id },
  ];
  if (a.method_id) links.push({ rel: 'paymentMethod', type: 'payment_method', id: a.method_id });
  return {
    status: { authorization: a.status },
    allowedActions: actions,
    issues,
    links,
    provenance: provenanceOf(a.mode),
  };
}

export function refundRecord(r: RefundRow, rc: RecordContext): RecordParts {
  const pending = r.status === 'processing' || r.status === 'pending_verification';
  const issues: RecordIssue[] = [];
  if (r.status === 'pending_verification') {
    issues.push({
      code: 'pending_verification',
      severity: 'warning',
      message: 'Outcome unknown — being verified with the provider. Do not refund again.',
    });
  }
  if (r.ledger_status === 'failed') {
    issues.push({
      code: 'ledger_not_posted',
      severity: 'blocking',
      message: 'The refund is not yet shown on the bill.',
    });
  }
  issues.push(...(rc.issues.get(`refund:${r.id}`) ?? []));
  return {
    status: { refund: r.status, ledger: r.ledger_status },
    allowedActions: [
      action(
        'checkStatus',
        'Check with provider now',
        pending,
        pending ? undefined : 'The outcome is already final.',
      ),
    ],
    issues,
    links: [{ rel: 'payment', type: 'payment', id: r.payment_id }],
    provenance: provenanceOf(r.mode),
  };
}

export function requestRecord(r: RequestRow, rc: RecordContext): RecordParts {
  const can = rc.authz.can('payments.paymentRequest.create', { propertyId: r.property_id });
  const open = r.status === 'open' || r.status === 'partially_paid';
  const cancelReason = !open
    ? `The request is already ${r.status}.`
    : can
      ? undefined
      : noPermission('payments.paymentRequest.create');
  const actions: RecordAction[] = [
    action('cancel', 'Cancel request', !cancelReason, cancelReason, true),
    action(
      'copyLink',
      'Copy payment link',
      open && r.link_status === 'created',
      !open
        ? `The request is ${r.status}.`
        : r.link_status === 'failed'
          ? 'The provider refused to create the link; cancel and create a new request.'
          : 'The link is not created yet (the provider may be unavailable); Portico retries automatically.',
    ),
  ];
  if (r.mode === 'simulate') {
    actions.push(
      action(
        'simulatePayment',
        'Simulate the guest paying',
        open && r.link_status === 'created',
        'The link is not ready.',
      ),
    );
  }
  const issues: RecordIssue[] = [...(rc.issues.get(`payment_request:${r.id}`) ?? [])];
  if (open && r.link_status !== 'created') {
    issues.push({
      code: 'link_not_created',
      severity: r.link_status === 'failed' ? 'blocking' : 'warning',
      message:
        r.link_status === 'failed'
          ? 'The provider refused to create the payment link.'
          : 'The payment link has not been created yet; it will be created when the provider is available.',
    });
  }
  const links: RecordLink[] = [
    refLink(r.ref_type, r.ref_id),
    { rel: 'paymentAccount', type: 'payment_account', id: r.account_id },
  ];
  const payer = (r.payer ?? {}) as { type?: string; id?: string; name?: string };
  if (payer.id && payer.type && payer.type !== 'other') {
    links.push({
      rel: 'payer',
      type: payer.type,
      id: payer.id,
      ...(payer.name ? { title: payer.name } : {}),
    });
  }
  return {
    status: { paymentRequest: r.status, link: r.link_status },
    allowedActions: actions,
    issues,
    links,
    provenance: provenanceOf(r.mode),
  };
}

export function exceptionRecord(e: ExceptionRow, authz: Authorizer): RecordParts {
  const perm = e.property_id ? 'payments.reconciliation.manage' : 'payments.account.manage';
  const allowed = e.property_id ? authz.can(perm, { propertyId: e.property_id }) : authz.can(perm);
  const reason = e.status !== 'open' ? 'Already resolved.' : allowed ? undefined : noPermission(perm);
  return {
    status: { exception: e.status },
    allowedActions: [action('resolve', 'Resolve', !reason, reason)],
    issues: [],
    owner: exceptionOwner(e.owner_role),
    links: e.ref_type && e.ref_id ? [{ rel: 'subject', type: e.ref_type, id: e.ref_id }] : [],
  };
}
