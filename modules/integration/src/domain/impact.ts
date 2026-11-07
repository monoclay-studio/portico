/**
 * Plain-English impact statements: which hotel functions are affected, at which properties, before an action is
 * taken (adoption brief §9: "Explain which hotel functions will be affected before taking action") and while a
 * connection is unhealthy. No payloads, no jargon. Pure logic — no IO.
 */
import type { DataDomain, HotelFunctionImpact, ImpactStatement, WorkflowOperation } from '../contracts';

export interface WorkflowInfo {
  label: string;
  hotelFunction: string;
  domain: DataDomain | null;
  /** Critical workflows make a delay urgent (bookings, inventory, money). */
  critical: boolean;
}

export const WORKFLOWS: Readonly<Record<string, WorkflowInfo>> = {
  reservations: {
    label: 'Reservations',
    hotelFunction: 'Reservations and arrivals',
    domain: 'reservations',
    critical: true,
  },
  availability: {
    label: 'Availability',
    hotelFunction: 'Availability and selling',
    domain: 'availability',
    critical: true,
  },
  rates: {
    label: 'Rates and restrictions',
    hotelFunction: 'Prices and restrictions',
    domain: 'rates',
    critical: true,
  },
  roomStatus: {
    label: 'Room status',
    hotelFunction: 'Housekeeping room status',
    domain: 'roomStatus',
    critical: false,
  },
  charges: {
    label: 'Guest charges',
    hotelFunction: 'Guest bills (charges)',
    domain: 'charges',
    critical: true,
  },
  posCharges: {
    label: 'Outlet charges',
    hotelFunction: 'Restaurant and bar charges to rooms',
    domain: 'charges',
    critical: true,
  },
  payments: { label: 'Payments', hotelFunction: 'Payments and deposits', domain: 'payments', critical: true },
  guestProfiles: {
    label: 'Guest profiles',
    hotelFunction: 'Guest profiles',
    domain: 'guestProfiles',
    critical: false,
  },
  maintenance: {
    label: 'Maintenance',
    hotelFunction: 'Maintenance work orders',
    domain: 'maintenance',
    critical: false,
  },
  journals: {
    label: 'Accounting journals',
    hotelFunction: 'Accounting exports',
    domain: 'accounting',
    critical: false,
  },
  webhooks: {
    label: 'Partner notifications',
    hotelFunction: 'Partner app notifications',
    domain: null,
    critical: false,
  },
};

export function workflowInfo(workflow: string): WorkflowInfo {
  return WORKFLOWS[workflow] ?? { label: workflow, hotelFunction: workflow, domain: null, critical: false };
}

export type ImpactSituation =
  | 'activation'
  | 'interrupted'
  | 'paused'
  | 'resume'
  | 'disconnected'
  | 'credential_rotation'
  | 'replacement';

const receives = (ops: readonly WorkflowOperation[]) => ops.includes('read') || ops.includes('receive');
const writes = (ops: readonly WorkflowOperation[]) => ops.includes('create') || ops.includes('update');

export function workflowImpact(
  workflow: string,
  operations: readonly WorkflowOperation[],
  situation: ImpactSituation,
  systemName: string,
  opts: { forward?: boolean; fileBased?: boolean; replacementName?: string } = {},
): HotelFunctionImpact {
  const info = workflowInfo(workflow);
  const parts: string[] = [];
  switch (situation) {
    case 'activation':
      if (receives(operations)) {
        parts.push(
          opts.fileBased
            ? `Portico will take ${info.label.toLowerCase()} from files you import from ${systemName}. Imported data is labeled file-based and is only as current as the last file.`
            : `Portico will receive ${info.label.toLowerCase()} from ${systemName} and show them labeled external, with the last-sync time.`,
        );
      }
      if (writes(operations)) {
        parts.push(
          opts.forward
            ? `Changes made in Portico are sent to ${systemName} and count only once ${systemName} confirms them; until then they show as pending.`
            : `Portico sends ${info.label.toLowerCase()} to ${systemName}.`,
        );
      }
      break;
    case 'interrupted':
    case 'paused':
      if (receives(operations)) {
        parts.push(
          `Changes made in ${systemName} are not reaching Portico. Portico keeps showing its last copy, labeled delayed.`,
        );
      }
      if (writes(operations)) {
        parts.push(
          `Actions for ${systemName} wait in a queue. Money and inventory actions will need a person's confirmation before they are sent.`,
        );
      }
      break;
    case 'resume':
      parts.push(
        `Exchange with ${systemName} restarts. Queued money and inventory actions are held for your confirmation first, so nothing is charged twice or reopened by mistake.`,
      );
      break;
    case 'disconnected':
      if (receives(operations)) {
        parts.push(
          `Portico stops receiving updates from ${systemName}. Existing copies stay visible, labeled external and no longer updated.`,
        );
      }
      if (writes(operations)) {
        parts.push(
          `Portico can no longer send changes to ${systemName}; queued actions are cancelled for review.`,
        );
      }
      break;
    case 'credential_rotation':
      parts.push(
        `No interruption expected: the new credential is tested with ${systemName} before the old one is retired. If the test fails, nothing changes.`,
      );
      break;
    case 'replacement':
      parts.push(
        `${info.hotelFunction} moves from ${systemName} to ${opts.replacementName ?? 'the replacement system'}. Queued actions for ${systemName} are held for review, never moved automatically.`,
      );
      break;
  }
  return { workflow, hotelFunction: info.hotelFunction, effect: parts.join(' ') };
}

export function buildImpact(input: {
  systemName: string;
  situation: ImpactSituation;
  properties: ReadonlyArray<{ id: string; name: string }>;
  workflows: ReadonlyArray<{ workflow: string; operations: readonly WorkflowOperation[] }>;
  forwardDomains?: ReadonlySet<DataDomain>;
  fileBased?: boolean;
  replacementName?: string;
}): ImpactStatement {
  const hotelFunctions = input.workflows.map((w) => {
    const domain = workflowInfo(w.workflow).domain;
    return workflowImpact(w.workflow, w.operations, input.situation, input.systemName, {
      forward: domain !== null && (input.forwardDomains?.has(domain) ?? false),
      ...(input.fileBased !== undefined ? { fileBased: input.fileBased } : {}),
      ...(input.replacementName ? { replacementName: input.replacementName } : {}),
    });
  });
  const where =
    input.properties.length === 0
      ? 'the whole organization'
      : input.properties.length === 1
        ? (input.properties[0]?.name ?? 'one property')
        : `${input.properties.length} properties (${input.properties.map((p) => p.name).join(', ')})`;
  const functions = [...new Set(hotelFunctions.map((f) => f.hotelFunction))];
  const verb: Record<ImpactSituation, string> = {
    activation: 'will change',
    interrupted: 'are affected now',
    paused: 'will be affected',
    resume: 'will restart',
    disconnected: 'will be affected',
    credential_rotation: 'should not be affected',
    replacement: 'will move',
  };
  const summary =
    functions.length === 0
      ? `No hotel functions use ${input.systemName} at ${where}.`
      : `${functions.join(', ')} at ${where} ${verb[input.situation]}.`;
  return { summary, properties: [...input.properties], hotelFunctions };
}

const DOMAIN_LABEL: Record<DataDomain, string> = {
  reservations: 'reservations',
  availability: 'availability',
  rates: 'rates and restrictions',
  guestProfiles: 'guest profiles',
  charges: 'guest charges',
  payments: 'payments',
  roomStatus: 'room status',
  maintenance: 'maintenance',
  accounting: 'accounting',
};

export function domainLabel(domain: DataDomain): string {
  return DOMAIN_LABEL[domain];
}

/**
 * Domains whose system of record changes only with a second person's approval (platform CR-10): integration plans an
 * authority transition for these instead of changing them at activation.
 */
export const SECOND_APPROVAL_DOMAINS: readonly DataDomain[] = [
  'charges',
  'payments',
  'accounting',
  'availability',
];

export function needsSecondApproval(domain: DataDomain): boolean {
  return SECOND_APPROVAL_DOMAINS.includes(domain);
}

/** One sentence explaining what a data-authority change means for staff. */
export function explainAuthorityChange(
  domain: DataDomain,
  after: { authority: 'portico' | 'external'; writeMode: 'exclusive' | 'forward' | 'read_only' },
  systemName: string,
): string {
  const d = DOMAIN_LABEL[domain];
  if (after.authority === 'portico') {
    return `Portico becomes the system of record for ${d}. Staff must stop changing ${d} in ${systemName}.`;
  }
  if (after.writeMode === 'forward') {
    return `${systemName} becomes the system of record for ${d}. Changes made in Portico are forwarded and stay pending until ${systemName} confirms them.`;
  }
  return `${systemName} becomes the system of record for ${d}. Portico shows ${d} but staff change them in ${systemName}.`;
}
