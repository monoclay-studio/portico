/**
 * Stories-style examples for every design-system component, rendered at /design-system in the back office.
 * Sample content is invented Maldives data; nothing here talks to an API.
 */
import { Bell, CalendarRange, Plus, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, IconButton } from '../components/button';
import { ChangePreview } from '../components/change-preview';
import { Combobox } from '../components/combobox';
import { CommandPalette } from '../components/command-palette';
import { classifyConflict } from '../components/conflict';
import { ConflictDialog } from '../components/conflict-dialog';
import { DataTable } from '../components/data-table/data-table';
import type { ColumnDef } from '../components/data-table/model';
import { Code, DataText } from '../components/data-text';
import { DatePicker, DateRangePicker } from '../components/date-picker';
import { Dialog } from '../components/dialog';
import { Drawer } from '../components/drawer';
import { EmptyState } from '../components/empty-state';
import { EnvironmentBanner, NON_LIVE_ENVIRONMENTS } from '../components/environment-banner';
import { Field } from '../components/field';
import { FilterChips } from '../components/filter-chips';
import { Input } from '../components/input';
import { KpiTile } from '../components/kpi-tile';
import { OfflineIndicator } from '../components/offline-indicator';
import { ProblemAlert } from '../components/problem-alert';
import { PROVENANCE_KINDS, ProvenanceBadge } from '../components/provenance-badge';
import { EntityLink } from '../components/record/entity-link';
import { RecordView } from '../components/record/record-view';
import { SegmentedBar } from '../components/segmented-bar';
import { Select } from '../components/select';
import { Skeleton, SkeletonList } from '../components/skeleton';
import { SmallMultiples } from '../components/small-multiples';
import { STATUS_VALUES, StatusBadge, type StatusVocabulary } from '../components/status-badge';
import { StepTracker } from '../components/step-tracker';
import { Tabs } from '../components/tabs';
import { Timeline } from '../components/timeline/timeline';
import { useToast } from '../components/toast';
import { Tooltip } from '../components/tooltip';

function Story({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div>
        <h2 id={`${id}-h`} className="text-base font-semibold">
          {title}
        </h2>
        {note && <p className="text-sm text-ink-muted">{note}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

interface Villa {
  id: string;
  name: string;
  type: string;
  condition: (typeof STATUS_VALUES.condition)[number];
  rate: number;
}
const TYPES = ['Beach Villa', 'Water Villa', 'Sunset Water Villa with Pool'];
const VILLAS: Villa[] = Array.from({ length: 1200 }, (_, i) => ({
  id: `v${i}`,
  name: `Villa ${100 + i}`,
  type: TYPES[i % 3] as string,
  condition: STATUS_VALUES.condition[i % 5] as Villa['condition'],
  rate: 65000 + (i % 7) * 5000,
}));
const villaColumns: ColumnDef<Villa>[] = [
  { id: 'name', header: 'Villa', accessor: (v) => v.name, hideable: false, cell: (v) => <Code>{v.name}</Code> },
  { id: 'type', header: 'Unit type', accessor: (v) => v.type, filter: 'select' },
  { id: 'condition', header: 'Condition', accessor: (v) => v.condition, filter: 'select', cell: (v) => <StatusBadge vocabulary="condition" value={v.condition} /> },
  { id: 'rate', header: 'Rate', accessor: (v) => v.rate, align: 'end', cell: (v) => <Code>${(v.rate / 100).toFixed(2)}</Code> },
];

export const EXAMPLE_SECTIONS = [
  ['tokens', 'Tokens & voices'],
  ['buttons', 'Button & IconButton'],
  ['inputs', 'Inputs, Select, Combobox, date pickers'],
  ['overlays', 'Dialog, Drawer, Toast, Tooltip, Tabs'],
  ['status', 'StatusBadge vocabularies'],
  ['provenance', 'ProvenanceBadge & EnvironmentBanner'],
  ['problems', 'ProblemAlert & OfflineIndicator'],
  ['concurrency', 'ConflictDialog & ChangePreview'],
  ['workflow', 'StepTracker'],
  ['kpi', 'KPI tiles, segmented bar, small multiples'],
  ['record', 'Universal record & EntityLink'],
  ['table', 'DataTable (1,200 rows, virtualized)'],
  ['timeline', 'Timeline'],
  ['palette', 'CommandPalette'],
  ['empty', 'EmptyState & Skeleton'],
] as const;

export function UiExamples() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [palette, setPalette] = useState(false);
  const [villa, setVilla] = useState<string | null>(null);
  const [chips, setChips] = useState(['Condition: Dirty', 'Section: Jetty A']);
  const conflictRows = classifyConflict(
    { checkInTime: '14:00', checkOutTime: '12:00', name: 'Azure Atoll Resort' },
    { checkInTime: '13:00', checkOutTime: '11:00' },
    { checkInTime: '15:00', checkOutTime: '12:00', name: 'Azure Atoll Resort & Spa' },
    ['name', 'checkInTime', 'checkOutTime'],
  ).map((r) => ({ ...r, label: r.key }));

  return (
    <div className="flex flex-col gap-5">
      <Story id="tokens" title="Tokens & voices" note="UI voice for labels; the monospace data voice for counts, codes and IDs; tabular figures in columns.">
        <p className="text-sm">
          Booking <Code>K7P2M9QX</Code> · Villa <Code>214</Code> · <DataText>96 of 120 villas</DataText>
        </p>
        <div className="flex flex-wrap gap-2">
          {['canvas', 'surface', 'surface-muted', 'accent', 'success-solid', 'warning-solid', 'danger-solid', 'info-solid', 'pending-solid', 'viz-seq'].map((c) => (
            <span key={c} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-xs">
              <span className="size-4 rounded-sm border border-line" style={{ background: `var(--color-${c})` }} />
              <Code>{c}</Code>
            </span>
          ))}
        </div>
      </Story>

      <Story id="buttons" title="Button & IconButton">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Plus />}>
            New booking
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Cancel booking</Button>
          <Button variant="link">Link</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Search" icon={<Search />} shortcut="/" />
          <IconButton label="Notifications" icon={<Bell />} variant="secondary" />
        </div>
      </Story>

      <Story id="inputs" title="Inputs, Select, Combobox, date pickers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Guest name" description="As on the passport">
            <Input placeholder="Sophie Laurent" />
          </Field>
          <Field label="Email" error="Enter an email like name@example.com">
            <Input defaultValue="sophie@" />
          </Field>
          <Field label="Meal plan">
            <Select
              defaultValue="hb"
              options={[
                { value: 'ro', label: 'Room only' },
                { value: 'bb', label: 'Bed & breakfast' },
                { value: 'hb', label: 'Half board' },
                { value: 'ai', label: 'All inclusive' },
              ]}
            />
          </Field>
          <Field label="Villa">
            <Combobox
              value={villa}
              onValueChange={setVilla}
              options={VILLAS.slice(0, 60).map((v) => ({ value: v.id, label: v.name, description: v.type, keywords: [v.type] }))}
            />
          </Field>
          <Field label="Arrival">
            <DatePicker today="2026-11-07" defaultValue="2026-11-14" />
          </Field>
          <Field label="Stay dates">
            <DateRangePicker today="2026-11-07" defaultValue={{ from: '2026-11-14', to: '2026-11-18' }} />
          </Field>
        </div>
      </Story>

      <Story id="overlays" title="Dialog, Drawer, Toast, Tooltip, Tabs">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button onClick={() => toast({ tone: 'success', title: 'Villa 214 marked inspected' })}>Success toast</Button>
          <Button onClick={() => toast({ tone: 'error', title: 'Key not issued', description: 'The door lock system did not answer. Nothing was charged.', reference: 'c0ffee-42' })}>
            Error toast (stays)
          </Button>
          <Button onClick={() => toast({ tone: 'pending', title: 'Payment pending verification', description: 'We are waiting for the provider. Do not charge again.' })}>
            Pending toast
          </Button>
          <Tooltip content="Tooltips add hints; they never hold essential information">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </div>
        <Dialog open={dialog} onOpenChange={setDialog} title="Move to Villa 216?" description="Same unit type; the agreed price is kept." footer={<Button variant="primary" onClick={() => setDialog(false)}>Confirm move</Button>}>
          <p className="text-sm">Housekeeping gets a task to prepare Villa 216 before 14:00.</p>
        </Dialog>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Water Villa 212" description="Jetty A" meta={<StatusBadge vocabulary="condition" value="failed_inspection" />}>
          <p className="text-sm">Drawers keep the list behind them in context.</p>
        </Drawer>
        <Tabs
          aria-label="Front desk"
          items={[
            { value: 'arr', label: 'Arrivals', count: 18, content: <p className="text-sm">18 arrivals today.</p> },
            { value: 'dep', label: 'Departures', count: 12, content: <p className="text-sm">12 departures.</p> },
            { value: 'inh', label: 'In house', count: 104, content: <p className="text-sm">104 units occupied.</p> },
          ]}
        />
      </Story>

      <Story id="status" title="StatusBadge vocabularies" note="Six vocabularies, six shapes — never merged into one field or one badge.">
        {(Object.keys(STATUS_VALUES) as StatusVocabulary[]).map((v) => (
          <div key={v} className="flex flex-wrap items-center gap-1.5">
            <span className="pt-data w-28 text-ink-muted">{v}</span>
            {STATUS_VALUES[v].map((value) => (
              <StatusBadge key={value} vocabulary={v} value={value as never} />
            ))}
          </div>
        ))}
      </Story>

      <Story id="provenance" title="ProvenanceBadge & EnvironmentBanner">
        <div className="flex flex-wrap gap-2">
          {PROVENANCE_KINDS.map((p) => (
            <ProvenanceBadge key={p} provenance={p} {...(p === 'external' ? { system: 'Legacy PMS', lastSyncedAt: '2026-11-07T04:55:00Z', now: new Date('2026-11-07T05:00:00Z') } : {})} />
          ))}
        </div>
        <div className="flex flex-col gap-2 overflow-hidden rounded-md border border-line">
          {NON_LIVE_ENVIRONMENTS.map((e) => (
            <EnvironmentBanner key={e} environment={e} organizationName="Azure Atoll Collection" frame={false} />
          ))}
        </div>
      </Story>

      <Story id="problems" title="ProblemAlert & OfflineIndicator">
        <ProblemAlert
          onRetry={() => {}}
          problem={{
            type: 'https://docs.portico.app/errors/external_service_error',
            title: 'External service problem',
            status: 502,
            code: 'external_service_error',
            detail: 'The payment provider did not answer in time. The charge may or may not have happened — it is now pending verification. Do not charge again; check the status in a minute.',
            retryable: true,
            correlationId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
          }}
        />
        <OfflineIndicator online={false} lastUpdatedAt="2026-11-07T05:42:00Z" timeZone="Indian/Maldives" />
      </Story>

      <Story id="concurrency" title="ConflictDialog & ChangePreview">
        <Button onClick={() => setConflict(true)}>Show a 409 conflict</Button>
        <ConflictDialog open={conflict} onOpenChange={setConflict} entity="property" rows={conflictRows} expectedVersion={3} currentVersion={4} changedBy="Aishath" changedAt="2 min ago" onReapply={() => setConflict(false)} onDiscard={() => setConflict(false)} />
        <ChangePreview
          title="Extend stay of Sophie Laurent by 2 nights"
          summary="Water Villa 212 · departure 16 Nov → 18 Nov"
          provenance={<ProvenanceBadge provenance="simulated" />}
          validUntil="10:58"
          sections={[
            { kind: 'availability', rows: [{ label: 'Water Villa · 16 Nov', before: '3 free', after: '2 free', delta: '−1' }, { label: 'Water Villa · 17 Nov', before: '1 free', after: '0 free', delta: '−1', attention: 'warning' }] },
            { kind: 'price', rows: [{ label: 'Accommodation', before: '$3,920.00', after: '$5,880.00', delta: '+$1,960.00' }] },
            { kind: 'taxes', rows: [{ label: 'TGST (sample 17%)', before: '$733.04', after: '$1,099.56', delta: '+$366.52' }] },
            { kind: 'deposits', rows: [{ label: 'Deposit held', before: '$1,176.00', after: '$1,176.00', changed: false }] },
            { kind: 'balance', rows: [{ label: 'Balance due', before: '$3,906.24', after: '$6,315.36', delta: '+$2,409.12' }] },
          ]}
          consequences={['Departure clean moves to 18 Nov.', 'Nothing is charged now.']}
          onConfirm={() => toast({ tone: 'success', title: 'Confirmed (example)' })}
          onBack={() => {}}
        />
      </Story>

      <Story id="workflow" title="StepTracker">
        <StepTracker
          title="Check-in — Elena Petrova"
          onResume={() => {}}
          onRetryStep={() => {}}
          steps={[
            { id: 'id', label: 'Verify identity', status: 'done', detail: 'Passport scanned at the jetty 10:58' },
            { id: 'pay', label: 'Secure payment', status: 'pending_verification', detail: 'Terminal timed out after sending the charge' },
            { id: 'key', label: 'Issue key', status: 'failed', error: 'Door lock system did not answer. Try again or issue a manual key.' },
            { id: 'msg', label: 'Send welcome message', status: 'pending' },
          ]}
        />
      </Story>

      <Story id="kpi" title="KPI tiles, segmented bar, small multiples" note="Big number + delta + the raw counts behind it + a definition; charts only when they answer a question.">
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label="Occupancy tonight" value="80%" ratio={0.8} counts={{ numerator: 96, denominator: 120, unit: 'villas' }} delta={{ label: '+4 pts', direction: 'up', goodWhen: 'up', period: 'same night last week' }} definition="Units with a stay covering tonight ÷ sellable units." provenance={<ProvenanceBadge provenance="simulated" compact />} onOpen={() => {}} />
          <KpiTile label="Arrivals" value="18" ratio={11 / 18} counts={{ numerator: 11, denominator: 18, unit: 'ready' }} definition="Stays arriving on the business date." onOpen={() => {}} />
          <KpiTile label="Payments pending verification" value="2" tone="attention" annotation="USD 1,680.00 AWAITING CONFIRMATION" definition="Outcome unknown until the provider confirms." onOpen={() => {}} />
        </div>
        <SegmentedBar
          label="Arrival readiness"
          unit="arrivals"
          segments={[
            { id: 'in', label: 'Checked in', value: 3, kind: 'neutral' },
            { id: 'ready', label: 'Ready', value: 8, kind: 'good' },
            { id: 'att', label: 'Needs attention', value: 2, kind: 'warning' },
            { id: 'blk', label: 'Blocked', value: 5, kind: 'critical' },
          ]}
        />
        <SmallMultiples
          label="Occupancy next 7 nights"
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          series={TYPES.map((ty, s) => ({
            id: ty,
            label: ty,
            points: Array.from({ length: 7 }, (_, i) => ({ x: String(7 + i), xLabel: `${7 + i} Nov`, value: 0.55 + ((i * 7 + s * 13) % 40) / 100 })),
          }))}
        />
      </Story>

      <Story id="record" title="Universal record & EntityLink" note="Header with separate status chips + provenance, next actions (disabled ones say why), issues, owner, details, related, history.">
        <p className="text-sm">
          Hover or focus:{' '}
          <EntityLink type="unit" id="wv212" onOpen={() => {}} loadSummary={async () => ({ type: 'unit', id: 'wv212', title: 'Villa 212', subtitle: 'Water Villa · Jetty A', status: { condition: 'failed_inspection', occupancy: 'vacant' }, propertyId: null, label: 'Unit' })}>
            Villa 212
          </EntityLink>
        </p>
        <RecordView
          model={{
            type: 'stay',
            id: 'example',
            typeLabel: 'Stay',
            title: 'Sophie Laurent',
            code: 'K7P2M9QX',
            subtitle: 'Villa 212 · Water Villa · 14 Nov → 18 Nov',
            status: [
              { family: 'booking', vocabulary: 'booking', value: 'confirmed' },
              { family: 'stay', vocabulary: 'stay', value: 'expected' },
              { family: 'payment', vocabulary: 'payment', value: 'pending_verification' },
            ],
            provenance: { kind: 'simulated' },
            actions: [
              { action: 'checkIn', label: 'Check in', enabled: false, reason: 'Villa 212 failed inspection at 09:12 — re-clean in progress' },
              { action: 'extend', label: 'Extend stay', enabled: true, previewRequired: true },
              { action: 'move', label: 'Move unit', enabled: true },
              { action: 'cancel', label: 'Cancel booking', enabled: false, reason: 'Needs the reservations module' },
            ],
            issues: [{ code: 'condition', severity: 'blocking', message: 'Villa 212 failed inspection (shower drain)', owner: { kind: 'department', id: 'hk', name: 'Housekeeping' } }],
            owner: { kind: 'user', id: 'a', name: 'Aishath (front desk)' },
            sections: [{ id: 'd', title: 'Details', content: <p className="text-sm">2 adults · Half board · seaplane SP 14</p> }],
            links: [{ rel: 'unit', type: 'unit', id: 'wv212', title: 'Villa 212' }],
            helpKey: 'reservations.stay.record',
          }}
          history={{ state: 'ready', items: [{ at: '2026-10-01T09:14:00+05:00', action: 'Booking confirmed', actor: { kind: 'user', label: 'Reservations' }, reason: null }] }}
          onAction={() => {}}
          renderLink={(l) => <span className="font-medium">{l.title}</span>}
        />
      </Story>

      <Story id="table" title="DataTable (1,200 rows, virtualized)" note="Sort from headers, filters, quick search, column visibility, saved views, chips, keyboard grid navigation.">
        <FilterChips viewName="Dirty on Jetty A" chips={chips.map((c) => ({ id: c, label: c, onRemove: () => setChips(chips.filter((x) => x !== c)) }))} onClearAll={() => setChips([])} />
        <DataTable
          label="Villas"
          columns={villaColumns}
          rows={VILLAS}
          getRowId={(v) => v.id}
          maxHeight="22rem"
          views={[
            { id: 'all', name: 'All villas', builtIn: true, state: { sort: null, filters: {}, search: '', hidden: [] } },
            { id: 'dirty', name: 'Dirty first', builtIn: true, state: { sort: { columnId: 'condition', direction: 'asc' }, filters: { condition: 'dirty' }, search: '', hidden: [] } },
          ]}
          onSaveView={() => toast({ tone: 'success', title: 'View saved (example)' })}
        />
      </Story>

      <Story id="timeline" title="Timeline">
        <Timeline
          label="Example timeline"
          from="2026-11-05"
          days={14}
          today="2026-11-07"
          maxHeight="18rem"
          units={VILLAS.slice(0, 40).map((v) => ({ id: v.id, label: v.name, group: v.type }))}
          items={[
            { id: 's1', unitId: 'v0', kind: 'stay', from: '2026-11-03', to: '2026-11-09', label: 'Laurent', stayStatus: 'in_house' },
            { id: 's2', unitId: 'v0', kind: 'stay', from: '2026-11-09', to: '2026-11-13', label: 'Zhang', stayStatus: 'expected', flags: ['VIP'] },
            { id: 'b1', unitId: 'v1', kind: 'block', from: '2026-11-07', to: '2026-11-10', label: 'AC repair', blockKind: 'out_of_order' },
            { id: 'h1', unitId: 'v2', kind: 'hold', from: '2026-11-11', to: '2026-11-14', label: 'Option Q-1182' },
            { id: 's3', unitId: 'v4', kind: 'stay', from: '2026-11-01', to: '2026-11-07', label: 'Mehta', stayStatus: 'departed' },
          ]}
        />
      </Story>

      <Story id="palette" title="CommandPalette">
        <Button icon={<CalendarRange />} onClick={() => setPalette(true)}>
          Open palette
        </Button>
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          commands={[
            { id: 'a', label: 'Arrivals', group: 'Go to', shortcut: 'G A', onSelect() {} },
            { id: 't', label: 'Timeline', group: 'Go to', shortcut: 'G T', onSelect() {} },
            { id: 'g', label: 'Sophie Laurent — K7P2M9QX', group: 'Records', badge: <ProvenanceBadge provenance="simulated" compact />, onSelect() {} },
            { id: 'n', label: 'New booking', group: 'Actions', shortcut: 'N', onSelect() {} },
          ]}
        />
      </Story>

      <Story id="empty" title="EmptyState & Skeleton">
        <EmptyState icon={<CalendarRange />} title="No departures today" description="Departures appear here once stays end on the business date." action={<Button>Open the timeline</Button>} />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-64" />
        </div>
        <SkeletonList rows={2} />
      </Story>
    </div>
  );
}
