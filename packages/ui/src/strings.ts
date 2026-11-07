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
    retrySafeKeyed: 'Trying again is safe: this request carries a key that prevents it from happening twice.',
    retrySafeRead: 'Trying again is safe: it only reloads information.',
    unknownOutcome: 'Outcome not confirmed',
    fieldErrors: 'Check these fields:',

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
  record: {
    breadcrumb: 'Record trail',
    openFullPage: 'Open full page',
    backTo: 'Back to {{title}}',
    moreActions: 'More actions',
    issues: 'Issues',
    noIssues: 'No open issues',
    owner: 'Owner',
    noOwner: 'No owner assigned',
    related: 'Related records',
    noRelated: 'No related records',
    history: 'History',
    historyEmpty: 'Nothing has been recorded for this record yet.',
    historyUnavailable: 'History for this record type is not available yet.',
    pin: 'Pin record',
    unpin: 'Unpin record',
    severity: { blocking: 'Blocking', warning: 'Warning', info: 'Info' },
    disabledBecause: 'Not available: {{reason}}',
    previewFirst: 'Shows a preview before anything changes',
    changes: '{{count}} field(s) changed',
    by: 'by {{actor}}',
    help: 'Help for this screen',
    loadingPreview: 'Loading preview…',
  },
  kpi: {
    definition: 'About {{metric}}',
    of: '{{numerator}} of {{denominator}}',
    up: 'up',
    down: 'down',
    flat: 'no change',
    vs: 'vs {{period}}',
    openRecords: 'Open the records behind {{metric}}',
  },
  chart: {
    showTable: 'Show as table',
    showChart: 'Show as chart',
    legend: 'Legend',
    value: 'Value',
  },
  chips: {
    remove: 'Remove filter {{label}}',
    view: 'View',
    clearAll: 'Clear all',
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
    keyboardHintSelectable:
      'j / k or arrow keys move between rows. Enter opens, x selects, e runs the row’s main action. Shift+click selects a range.',
    hiddenToFit: 'hidden to fit',
    hiddenColumns: '+{{count}} columns hidden to fit',
    hiddenColumnsOne: '+1 column hidden to fit',
    bulkActions: 'Actions for selected rows',
    selectedCount: '{{count}} selected',
    clearSelection: 'Clear selection',
    selectAll: 'Select all shown rows',
    selectRow: 'Select {{row}}',
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
    noResults:
      'No matches. Search by guest name, booking code, unit or property, or type the name of a screen.',
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
    generated: 'generated {{time}}',
    from: 'from {{system}}',
    kinds: {
      live: 'Live',
      simulated: 'Simulated',
      sandbox: 'Sandbox',
      copied: 'Copied',
      delayed: 'Delayed',
      incomplete: 'Incomplete',
      external: 'External',
    },
    descriptions: {
      live: 'Current information from Portico.',
      simulated: 'Sample data produced by a simulator. Not real guests, money or bookings.',
      sandbox: 'Result from a provider test system. Nothing real was charged, sent or published.',
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
      other: 'Not live',
    },
    descriptions: {
      other: 'This is not your live hotel. Nothing here reaches real guests, cards or channels.',
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
      discrepancy: 'Occupancy discrepancy',
      condition: 'Unit condition',
      unitAvailability: 'Unit availability',
      inventory: 'Inventory',
      payment: 'Payment status',
    },
    unknownValue: 'Unrecognised value “{{value}}”',
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
    },
    discrepancy: {
      skip: 'Skip (looks vacated)',
      sleep: 'Sleep (looks occupied)',
      occupied_no_luggage: 'Occupied, no luggage',
    },
    condition: {
      dirty: 'Dirty',
      cleaning: 'Cleaning',
      clean: 'Clean',
      inspected: 'Inspected',
      failed_inspection: 'Failed inspection',
    },
    unitAvailability: {
      available: 'Available',
      assigned: 'Assigned',
      out_of_order: 'Out of order',
      out_of_service: 'Out of service',
      house_use: 'House use',
    },
    inventory: {
      available: 'Available',
      limited: 'Last units',
      sold_out: 'Sold out',
      held: 'Held',
      overbooked_authorized: 'Overbooking authorized',
      oversold: 'Oversold — needs resolution',
    },
    payment: {
      none: 'No payment yet',
      requested: 'Payment requested',
      requires_action: 'Guest action needed',
      processing: 'Processing',
      pending_verification: 'Pending verification',
      authorized: 'Authorized (not paid)',
      partially_captured: 'Partly captured',
      captured: 'Captured',
      partially_paid: 'Partly paid',
      paid: 'Paid',
      succeeded: 'Paid',
      awaiting_receipt: 'Awaiting receipt',
      recorded_unverified: 'Recorded (not verified)',
      recorded_verified: 'Recorded (verified)',
      failed: 'Failed',
      voided: 'Voided',
      expired: 'Authorization expired',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      disputed: 'Disputed',
      unknown: 'Status unavailable',
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
