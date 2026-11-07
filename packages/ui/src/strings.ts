/**
 * Every user-visible string the design system renders by itself. English defaults; apps pass translations
 * through <UiProvider strings={…}> (plain JSON so it can live in i18n resource files). Placeholders use
 * {{name}} and are filled with `fmt`.
 */
export const defaultUiStrings = {
  common: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading…',
    working: 'Working…',
    copy: 'Copy',
    copied: 'Copied',
    more: 'More',
    clear: 'Clear',
    none: 'None',
  },
  toast: {
    region: 'Notifications ({{hotkey}})',
  },
  problem: {
    reference: 'Reference',
    copyReference: 'Copy reference {{id}}',
    retryableHint: 'It is safe to try again: a retry never repeats an action that already happened.',
    notRetryableHint: 'Trying again unchanged will fail the same way. Follow the steps above first.',
    fieldErrors: 'Check these fields:',
    offline: 'You appear to be offline. Nothing was sent. Reconnect and try again.',
    unknownTitle: 'Something went wrong',
  },
  conflict: {
    title: 'Someone else changed this {{entity}}',
    intro:
      'Your changes were not saved because this {{entity}} was updated after you opened it. Nothing was lost: review the differences, then re-apply your changes to the latest version.',
    changedBy: 'Changed by {{who}} {{when}}',
    field: 'Field',
    yours: 'Your change',
    theirs: 'Saved now',
    original: 'When you opened it',
    bothChanged: 'Both changed',
    onlyYou: 'Only you changed',
    onlyThem: 'Changed by someone else',
    keepThisChange: 'Re-apply this change',
    reapply: 'Re-apply my changes',
    reapplySelected: 'Re-apply {{count}} change(s)',
    discard: 'Discard mine, keep saved version',
    versionNote: 'You edited version {{expected}}; the saved version is now {{current}}.',
  },
  changePreview: {
    before: 'Before',
    after: 'After',
    change: 'Change',
    consequences: 'What else happens',
    confirm: 'Confirm change',
    back: 'Back to editing',
    expires: 'Preview valid until {{time}}. Prices and availability are re-checked when you confirm.',
    stale: 'This preview is out of date because something changed. Refresh it before confirming.',
    refresh: 'Refresh preview',
    noChange: 'No change',
    sections: {
      availability: 'Availability',
      price: 'Price',
      taxes: 'Taxes and fees',
      deposits: 'Deposits',
      balance: 'Balance',
    },
  },
  steps: {
    progress: '{{done}} of {{total}} steps complete',
    resume: 'Resume',
    retryStep: 'Retry this step',
    status: {
      done: 'Done',
      failed: 'Failed',
      pending: 'Not started',
      in_progress: 'In progress',
      skipped: 'Skipped',
      pending_verification: 'Pending verification',
    },
  },
  dataTable: {
    filterRows: 'Filter rows',
    filterPlaceholder: 'Filter…',
    columns: 'Columns',
    views: 'Views',
    saveView: 'Save current view',
    viewName: 'View name',
    save: 'Save',
    deleteView: 'Delete view {{name}}',
    defaultView: 'Default',
    all: 'All',
    filterColumn: 'Filter by {{column}}',
    sortedAsc: 'sorted ascending',
    sortedDesc: 'sorted descending',
    noRows: 'No rows match these filters.',
    clearFilters: 'Clear filters',
    rowCount: '{{shown}} of {{total}} rows',
    keyboardHint: 'Arrow keys move between cells. Enter opens the row.',
  },
  datePicker: {
    chooseDate: 'Choose date',
    chooseDates: 'Choose dates',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    invalid: 'Enter a date as YYYY-MM-DD.',
    start: 'From',
    end: 'To',
    nights: '{{count}} nights',
    night: '1 night',
    selectEnd: 'Now choose the departure date',
    today: 'Today',
  },
  combobox: {
    noMatches: 'No matches',
    showOptions: 'Show options',
    results: '{{count}} results available',
  },
  commandPalette: {
    title: 'Command palette',
    placeholder: 'Type a command or search…',
    noResults: 'No results. Try fewer words.',
    hint: '↑ ↓ to move · Enter to run · Esc to close',
  },
  timeline: {
    unit: 'Unit',
    previous: 'Earlier dates',
    next: 'Later dates',
    today: 'Today',
    free: 'free',
    cellLabel: '{{unit}}, {{date}}: {{content}}',
    keyboardHint: 'Arrow keys move between nights and units. Enter opens what is booked in that night.',
    kinds: { stay: 'Stay', block: 'Block', hold: 'Hold' },
  },
  offline: {
    offline: 'Offline',
    offlineDetail:
      'You are offline. Information shown is from {{time}} and may be out of date. Changes cannot be saved until the connection returns.',
    offlineDetailNoTime:
      'You are offline. Information shown may be out of date. Changes cannot be saved until the connection returns.',
    online: 'Online',
    apiUnreachable: 'Server unreachable',
    apiUnreachableDetail: 'The connection is up but Portico cannot be reached. Retrying automatically.',
  },
  provenance: {
    label: 'Data source',
    lastSynced: 'last synced {{time}}',
    from: 'from {{system}}',
    kinds: {
      live: 'Live',
      simulated: 'Simulated',
      copied: 'Copied',
      delayed: 'Delayed',
      incomplete: 'Incomplete',
      external: 'External',
    },
    descriptions: {
      live: 'Current information from Portico.',
      simulated: 'Sample data produced by a simulator. Not real guests, money or bookings.',
      copied: 'A copy of your data for evaluation. Changes here do not affect your current system.',
      delayed: 'This information is older than it should be. It may have changed since.',
      incomplete: 'Some of this information is missing. Do not rely on totals.',
      external: 'Received from another system, which is the system of record.',
    },
  },
  environment: {
    label: 'Environment',
    kinds: {
      demo: 'Demo',
      trial: 'Trial',
      training: 'Training',
      sandbox: 'Sandbox',
    },
    descriptions: {
      demo: 'Sample data. Nothing here can charge a card, message a guest or reach a real channel.',
      trial: 'Evaluation copy of your data. Isolated from your live hotel; external actions are simulated.',
      training: 'Practice environment. Bookings, payments and messages here are not real.',
      sandbox: 'Integration sandbox. Calls go to provider test systems only.',
    },
  },
  status: {
    vocabularies: {
      booking: 'Booking status',
      stay: 'Stay status',
      occupancy: 'Occupancy',
      condition: 'Unit condition',
      availability: 'Availability',
      payment: 'Payment status',
    },
    booking: {
      inquiry: 'Inquiry',
      quoted: 'Quoted',
      held: 'Held',
      tentative: 'Tentative',
      confirmed: 'Confirmed',
      cancelled: 'Cancelled',
      declined: 'Declined',
      expired: 'Expired',
      completed: 'Completed',
    },
    stay: {
      expected: 'Expected',
      in_house: 'In house',
      departed: 'Departed',
      cancelled: 'Cancelled',
      no_show: 'No-show',
      waitlisted: 'Waitlisted',
    },
    occupancy: {
      vacant: 'Vacant',
      occupied: 'Occupied',
      skip: 'Skip (looks vacated)',
      sleep: 'Sleep (looks occupied)',
    },
    condition: {
      dirty: 'Dirty',
      cleaning: 'Cleaning',
      clean: 'Clean',
      inspected: 'Inspected',
      failed_inspection: 'Failed inspection',
    },
    availability: {
      available: 'Available',
      limited: 'Last units',
      sold_out: 'Sold out',
      held: 'Held',
      blocked: 'Blocked',
      overbooked_authorized: 'Overbooking authorized',
      oversold: 'Oversold — needs resolution',
    },
    payment: {
      not_required: 'Not required',
      unpaid: 'Unpaid',
      requested: 'Payment requested',
      authorized: 'Authorized (not paid)',
      pending_verification: 'Pending verification',
      partially_paid: 'Partly paid',
      paid: 'Paid',
      failed: 'Failed',
      refunded: 'Refunded',
      guaranteed: 'Guaranteed',
    },
  },
};

export type UiStrings = typeof defaultUiStrings;

/** Deep partial for overrides from i18n resources. */
export type UiStringsOverride = {
  [K in keyof UiStrings]?: UiStrings[K] extends string ? string : DeepPartial<UiStrings[K]>;
};
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/** Fill {{name}} placeholders. Unknown placeholders are left visible so missing data is noticed in review. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function mergeStrings<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const b = out[k];
    if (typeof v === 'string' && typeof b === 'string') out[k] = v;
    else if (v && typeof v === 'object' && b && typeof b === 'object') out[k] = mergeStrings(b, v);
  }
  return out as T;
}
