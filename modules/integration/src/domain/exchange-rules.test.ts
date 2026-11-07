import { describe, expect, it } from 'vitest';
import { CsvError, parseCsv, parseCsvRecords, writeCsv } from './csv';
import { buildImpact, explainAuthorityChange, workflowImpact } from './impact';
import { decideOrdering, revisionOrderOf, sortForProcessing } from './inbound-ordering';
import {
  afterNegativeLookup,
  backoffSeconds,
  mustRevalidateOnReconnect,
  outcomeOfFailure,
  sendGate,
  stricterEffect,
  supersededStateCommands,
} from './outbound-policy';

const t = (iso: string) => new Date(iso);

describe('inbound ordering', () => {
  const base = { occurredAt: t('2026-11-07T10:00:00Z'), receivedAt: t('2026-11-07T10:00:30Z') };
  it('applies the first revision', () => {
    expect(
      decideOrdering({ revision: '1', revisionOrder: 1, ...base }, null, {
        sequential: true,
        freshnessTargetSeconds: 120,
      }),
    ).toEqual({
      action: 'apply',
      gapDetected: false,
      delayed: false,
      latencySeconds: 30,
    });
  });
  it('an older or equal revision arriving late is stale, never applied', () => {
    const wm = { lastRevision: '5', lastRevisionOrder: 5 };
    expect(
      decideOrdering({ revision: '4', revisionOrder: 4, ...base }, wm, {
        sequential: true,
        freshnessTargetSeconds: null,
      }),
    ).toMatchObject({
      action: 'stale',
      newerRevision: '5',
    });
    expect(
      decideOrdering({ revision: '5', revisionOrder: 5, ...base }, wm, {
        sequential: true,
        freshnessTargetSeconds: null,
      }).action,
    ).toBe('stale');
  });
  it('detects a gap only for sequential sources', () => {
    const wm = { lastRevision: '2', lastRevisionOrder: 2 };
    expect(
      decideOrdering({ revision: '5', revisionOrder: 5, ...base }, wm, {
        sequential: true,
        freshnessTargetSeconds: null,
      }),
    ).toMatchObject({ gapDetected: true });
    expect(
      decideOrdering({ revision: '5', revisionOrder: 5, ...base }, wm, {
        sequential: false,
        freshnessTargetSeconds: null,
      }),
    ).toMatchObject({ gapDetected: false });
    expect(
      decideOrdering({ revision: '3', revisionOrder: 3, ...base }, wm, {
        sequential: true,
        freshnessTargetSeconds: null,
      }),
    ).toMatchObject({ gapDetected: false });
  });
  it('flags delivery later than the freshness target as delayed (boundary is exclusive)', () => {
    const late = {
      revision: '1',
      revisionOrder: 1,
      occurredAt: t('2026-11-07T10:00:00Z'),
      receivedAt: t('2026-11-07T10:02:00Z'),
    };
    expect(decideOrdering(late, null, { sequential: false, freshnessTargetSeconds: 120 })).toMatchObject({
      delayed: false,
      latencySeconds: 120,
    });
    expect(decideOrdering(late, null, { sequential: false, freshnessTargetSeconds: 119 })).toMatchObject({
      delayed: true,
    });
  });
  it('clock skew never yields negative latency', () => {
    expect(
      decideOrdering(
        {
          revision: '1',
          revisionOrder: 1,
          occurredAt: t('2026-11-07T10:05:00Z'),
          receivedAt: t('2026-11-07T10:00:00Z'),
        },
        null,
        { sequential: false, freshnessTargetSeconds: 60 },
      ).latencySeconds,
    ).toBe(0);
  });
  it('sorts a reordered batch per record by revision', () => {
    const recs = [
      { workflow: 'reservations', externalId: 'R2', revisionOrder: 3 },
      { workflow: 'reservations', externalId: 'R1', revisionOrder: 2 },
      { workflow: 'reservations', externalId: 'R2', revisionOrder: 1 },
    ];
    expect(sortForProcessing(recs).map((r) => `${r.externalId}#${r.revisionOrder}`)).toEqual([
      'R1#2',
      'R2#1',
      'R2#3',
    ]);
  });
  it('parses integer and timestamp revisions', () => {
    expect(revisionOrderOf('42')).toBe(42);
    expect(revisionOrderOf('2026-11-07T10:00:00+05:00')).toBe(Date.parse('2026-11-07T05:00:00Z'));
    expect(revisionOrderOf('abc')).toBeNull();
  });
});

describe('outbound policy (no blind replay)', () => {
  const at = t('2026-11-07T10:00:00Z');
  it('holds money and inventory-reopening commands on reconnection, not standard ones', () => {
    const before = t('2026-11-07T09:00:00Z');
    expect(
      mustRevalidateOnReconnect(
        { status: 'queued', effectClass: 'money', enqueuedAt: before, attempts: 2 },
        at,
      ),
    ).toBe(true);
    expect(
      mustRevalidateOnReconnect(
        { status: 'pending_verification', effectClass: 'inventory_reopen', enqueuedAt: before, attempts: 1 },
        at,
      ),
    ).toBe(true);
    expect(
      mustRevalidateOnReconnect(
        { status: 'queued', effectClass: 'standard', enqueuedAt: before, attempts: 2 },
        at,
      ),
    ).toBe(false);
    expect(
      mustRevalidateOnReconnect(
        { status: 'acknowledged', effectClass: 'money', enqueuedAt: before, attempts: 1 },
        at,
      ),
    ).toBe(false);
  });
  it('does not send risky commands while interrupted; verifies uncertain ones first', () => {
    const cmd = {
      status: 'queued' as const,
      effectClass: 'money' as const,
      enqueuedAt: at,
      attempts: 0,
      verifyBeforeSend: false,
    };
    expect(sendGate(cmd, { operational: true, interrupted: true })).toMatchObject({ send: false });
    expect(sendGate({ ...cmd, effectClass: 'standard' }, { operational: true, interrupted: true })).toEqual({
      send: true,
      verifyFirst: false,
    });
    expect(
      sendGate({ ...cmd, status: 'pending_verification' }, { operational: true, interrupted: false }),
    ).toEqual({ send: true, verifyFirst: true });
    expect(sendGate(cmd, { operational: false, interrupted: false })).toMatchObject({ send: false });
  });
  it('classifies failures: timeout is unknown, refusals are final, outages retry', () => {
    expect(outcomeOfFailure('timeout', 1)).toEqual({ status: 'pending_verification' });
    expect(outcomeOfFailure('rejected', 1)).toEqual({ status: 'rejected' });
    expect(outcomeOfFailure('invalid', 1)).toEqual({ status: 'rejected' });
    expect(outcomeOfFailure('outage', 1)).toEqual({ status: 'queued', retryInSeconds: 5 });
  });
  it('after a negative lookup only standard commands are resent automatically', () => {
    expect(afterNegativeLookup('standard')).toBe('resend');
    expect(afterNegativeLookup('money')).toBe('needs_revalidation');
    expect(afterNegativeLookup('inventory_reopen')).toBe('needs_revalidation');
  });
  it('backoff follows 5,10,20,40 s then every 60 s, then 5 minutes', () => {
    expect([1, 2, 3, 4, 5, 34, 35].map(backoffSeconds)).toEqual([5, 10, 20, 40, 60, 60, 300]);
  });
  it('a caller can make the effect class stricter, never weaker', () => {
    expect(stricterEffect('standard', 'money')).toBe('money');
    expect(stricterEffect('money', 'standard')).toBe('money');
    expect(stricterEffect('inventory_reopen', undefined)).toBe('inventory_reopen');
  });
  it('coalesces queued state-setting commands to the newest per record (CL-06)', () => {
    const ids = supersededStateCommands([
      {
        id: 'a',
        effectClass: 'standard',
        businessKey: 'roomStatus:101',
        enqueuedAt: t('2026-11-07T09:00:00Z'),
        status: 'queued',
      },
      {
        id: 'b',
        effectClass: 'standard',
        businessKey: 'roomStatus:101',
        enqueuedAt: t('2026-11-07T09:10:00Z'),
        status: 'queued',
      },
      {
        id: 'c',
        effectClass: 'standard',
        businessKey: 'roomStatus:101',
        enqueuedAt: t('2026-11-07T09:05:00Z'),
        status: 'queued',
      },
      {
        id: 'd',
        effectClass: 'standard',
        businessKey: 'roomStatus:102',
        enqueuedAt: t('2026-11-07T09:00:00Z'),
        status: 'queued',
      },
      {
        id: 'e',
        effectClass: 'money',
        businessKey: 'roomStatus:101',
        enqueuedAt: t('2026-11-07T08:00:00Z'),
        status: 'queued',
      },
    ]);
    expect(ids.sort()).toEqual(['a', 'c']);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const text = '﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",2\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2'],
    ]);
  });
  it('reports malformed input with a line number', () => {
    expect(() => parseCsv('a,"b')).toThrow(CsvError);
    expect(() => parseCsvRecords('a,b\n1,2,3')).toThrow(/Row 2 has 3 columns/);
  });
  it('round-trips and neutralises spreadsheet formulas', () => {
    const out = writeCsv(
      ['k', 'v'],
      [
        { k: '=SUM(A1)', v: 'a,"b"' },
        { k: '-5', v: null },
      ],
    );
    expect(out).toBe(`k,v\r\n'=SUM(A1),"a,""b"""\r\n-5,\r\n`);
    expect(parseCsvRecords(out).records[0]).toEqual({ k: "'=SUM(A1)", v: 'a,"b"' });
  });
});

describe('impact statements', () => {
  it('describes what stops for each hotel function, at which properties', () => {
    const impact = buildImpact({
      systemName: 'Lagoon PMS',
      situation: 'paused',
      properties: [{ id: 'p1', name: 'Lagoon Island Resort' }],
      workflows: [
        { workflow: 'reservations', operations: ['read', 'receive'] },
        { workflow: 'charges', operations: ['create'] },
      ],
    });
    expect(impact.summary).toBe(
      'Reservations and arrivals, Guest bills (charges) at Lagoon Island Resort will be affected.',
    );
    expect(impact.hotelFunctions[0]?.effect).toMatch(/not reaching Portico/);
    expect(impact.hotelFunctions[1]?.effect).toMatch(/need a person's confirmation/);
  });
  it('labels file exchanges as not live', () => {
    expect(
      workflowImpact('reservations', ['read'], 'activation', 'Old PMS', { fileBased: true }).effect,
    ).toMatch(/file-based/);
  });
  it('explains authority changes in plain English', () => {
    expect(
      explainAuthorityChange('roomStatus', { authority: 'external', writeMode: 'forward' }, 'Lagoon PMS'),
    ).toMatch(/forwarded and stay pending/);
    expect(
      explainAuthorityChange('reservations', { authority: 'external', writeMode: 'read_only' }, 'Lagoon PMS'),
    ).toMatch(/staff change them in Lagoon PMS/);
    expect(
      explainAuthorityChange('charges', { authority: 'portico', writeMode: 'exclusive' }, 'Lagoon PMS'),
    ).toMatch(/stop changing/);
  });
});
