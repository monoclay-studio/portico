/**
 * The simulated Channex account of an organization, persisted in `distribution.sim_hubs` so the API (which receives
 * webhooks and serves the simulator controls) and the worker (which publishes ARI and acknowledges) share it.
 * Each request runs in its own transaction, like a call to an external system: its effects are committed
 * whatever the caller does afterwards. Never available to live organizations.
 */
import { type PorticoDatabase, type TxContext, typed, withTenantTx } from '@portico/db';
import { DomainError, newId, systemContext } from '@portico/kernel';
import type { DistributionDB } from '../../tables';
import { type HubHttpRequest, type HubHttpResponse, type HubTransport, HubTransportError } from '../hub';
import {
  addRevision,
  handleRequest,
  newSimState,
  type SimBookingInput,
  type SimRevision,
  type SimState,
  type WebhookDelivery,
  webhookDeliveries,
} from './simulator';

/** Where simulated webhooks go (bound to distribution's webhook receiver; no HTTP needed in-process). */
export interface WebhookSink {
  deliver(delivery: { callbackUrl: string; headers: Record<string, string>; rawBody: string }): Promise<{
    status: number;
  }>;
}

export class SimulatorNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      'simulator_not_found',
      `The simulated hub property ${id} does not exist in this organization. Create the connection again.`,
      { status: 404 },
    );
  }
}

export class ChannexSimulatorHub {
  private sink: WebhookSink | null = null;

  constructor(private readonly database: PorticoDatabase) {}

  setSink(sink: WebhookSink): void {
    this.sink = sink;
  }

  private ctx(tenantId: string) {
    return systemContext(tenantId, 'channex-simulator', 'sandbox', newId());
  }

  /** Run `fn` on the simulated property's state under a row lock and save it (in `tx` when given). */
  async run<T>(
    tenantId: string,
    propertyId: string,
    fn: (state: SimState, now: Date) => T,
    opts: { tx?: TxContext; write?: boolean } = {},
  ): Promise<T> {
    const write = opts.write ?? true;
    const body = async (tx: TxContext) => {
      const db = typed<DistributionDB>(tx.db);
      let q = db.selectFrom('distribution.sim_hubs').select(['state']).where('id', '=', propertyId);
      if (write) q = q.forUpdate();
      const row = await q.executeTakeFirst();
      if (!row) throw new SimulatorNotFoundError(propertyId);
      const state = row.state as SimState;
      const value = fn(state, tx.now);
      if (write) {
        await db
          .updateTable('distribution.sim_hubs')
          .set({ state: JSON.stringify(state), updated_at: tx.now })
          .where('id', '=', propertyId)
          .execute();
      }
      return value;
    };
    return opts.tx ? body(opts.tx) : withTenantTx(this.database, this.ctx(tenantId), body);
  }

  /** Create a simulated hub property inside the caller's transaction (connection setup). */
  async createProperty(
    tx: TxContext,
    input: Parameters<typeof newSimState>[0],
  ): Promise<{ propertyId: string; apiKey: string }> {
    const state = newSimState(input);
    await typed<DistributionDB>(tx.db)
      .insertInto('distribution.sim_hubs')
      .values({
        id: state.propertyId,
        tenant_id: tx.tenantId,
        state: JSON.stringify(state),
        updated_at: tx.now,
      })
      .execute();
    return { propertyId: state.propertyId, apiKey: state.apiKey };
  }

  read(tenantId: string, propertyId: string, tx?: TxContext): Promise<SimState> {
    return this.run(tenantId, propertyId, (s) => structuredClone(s), { write: false, ...(tx ? { tx } : {}) });
  }

  /** HTTP-level transport answering exactly like the simulated Channex API. */
  transport(tenantId: string, propertyId: string): HubTransport {
    return {
      send: async (req: HubHttpRequest): Promise<HubHttpResponse> => {
        const outcome = await this.run(tenantId, propertyId, (state, now) =>
          handleRequest(
            state,
            {
              method: req.method,
              url: req.url,
              headers: req.headers,
              ...(req.body !== undefined ? { body: req.body } : {}),
            },
            now,
          ),
        );
        if (outcome.kind === 'timeout') {
          throw new HubTransportError('timeout', 'the simulated hub did not answer in time', true);
        }
        return outcome.response;
      },
    };
  }

  /** The OTA side: record a booking revision at the hub (not yet delivered). */
  addRevision(
    tenantId: string,
    propertyId: string,
    input: SimBookingInput,
    tx?: TxContext,
  ): Promise<SimRevision> {
    return this.run(tenantId, propertyId, (s, now) => addRevision(s, input, now), tx ? { tx } : {});
  }

  /** Deliver webhooks for revisions (with duplicates / reordering / notification-only bodies when asked). */
  async deliver(
    tenantId: string,
    propertyId: string,
    revisionIds: readonly string[],
    opts: { duplicate?: number; reverse?: boolean; notificationOnly?: boolean } = {},
  ): Promise<Array<{ revisionId: string; status: number }>> {
    const list: WebhookDelivery[] = await this.run(
      tenantId,
      propertyId,
      (s, now) => webhookDeliveries(s, revisionIds, opts, now),
      { write: false },
    );
    const out: Array<{ revisionId: string; status: number }> = [];
    for (const d of list) {
      if (!this.sink) throw new Error('No webhook sink is bound to the Channex simulator.');
      const r = await this.sink.deliver({
        callbackUrl: d.callbackUrl,
        headers: d.headers,
        rawBody: d.rawBody,
      });
      out.push({ revisionId: d.revisionId, status: r.status });
    }
    return out;
  }
}
