import { BusinessRuleError } from '@portico/kernel';
import type { FolioStatus } from './types';

export type DestinationAction = 'post' | 'reopen' | 'supplementary';

/**
 * Where a new charge may land on an existing folio (scenario 10, FIN-R25):
 *  - open → post on it;
 *  - settled and never invoiced → reopen it (status open, reopen_count + 1, reason recorded);
 *  - settled with an issued invoice, or closed → a supplementary folio for the same payer, so issued
 *    invoices stay immutable;
 *  - voided → refused.
 */
export function destinationAction(folio: {
  status: FolioStatus;
  hasActiveInvoice: boolean;
}): DestinationAction {
  switch (folio.status) {
    case 'open':
      return 'post';
    case 'settled':
      return folio.hasActiveInvoice ? 'supplementary' : 'reopen';
    case 'closed':
      return 'supplementary';
    case 'voided':
      throw new BusinessRuleError(
        'folio_voided',
        'This folio was voided and cannot receive postings. Post to another folio of the same payer.',
      );
  }
}

/** A folio can be settled only at zero balance, and only from open. */
export function assertCanSettle(status: FolioStatus, balanceMinor: number, currency: string): void {
  if (status !== 'open') {
    throw new BusinessRuleError(
      'folio_not_open',
      `Only an open folio can be settled (this one is ${status}).`,
    );
  }
  if (balanceMinor !== 0) {
    throw new BusinessRuleError(
      'folio_balance_not_zero',
      `The folio still has a balance of ${balanceMinor} ${currency} (minor units). Collect a payment, transfer the balance to another folio or a receivables account, then settle.`,
      { balanceMinor, currency },
    );
  }
}

export function assertCanClose(status: FolioStatus): void {
  if (status !== 'settled') {
    throw new BusinessRuleError(
      'folio_not_settled',
      'Only a settled folio can be closed. Settle it first (zero balance).',
    );
  }
}

export function assertCanVoid(status: FolioStatus, postingCount: number): void {
  if (status !== 'open' || postingCount > 0) {
    throw new BusinessRuleError(
      'folio_cannot_void',
      'Only an open folio without any postings can be voided. Transfer or correct its postings instead.',
    );
  }
}
