import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, seedDemo } from '../src/seed/demo';
import { type ApiHarness, startApi } from './helpers';

let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

describe('demo environment (adoption brief §3 stage 1)', () => {
  it('seeds realistic Maldives demo organizations that staff can sign into, labeled as demo', async () => {
    const orgs = await seedDemo(h.t.db, { businessDate: '2026-11-07' });
    expect(orgs.map((o) => o.properties.length)).toEqual([1, 3]);
    const desk = orgs[1]?.users.find((u) => u.role === 'front_desk');
    const login = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: desk?.email, password: DEMO_PASSWORD },
    });
    expect(login.json()).toMatchObject({ status: 'signed_in', organization: { environment: 'demo' } });
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(me.json().environment).toBe('demo');
    const props = await h.app.inject({
      method: 'GET',
      url: '/v1/properties',
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(props.json().items).toHaveLength(3);
  }, 120_000); // seeds every composed module for two organizations; slow when many test packages run at once
});
