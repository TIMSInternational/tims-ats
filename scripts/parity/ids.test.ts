import { describe, it, expect } from 'vitest';
import { ID_SENTINEL, substituteEndpointId } from './ids';
import type { EndpointDef } from './surfaces';

describe('substituteEndpointId', () => {
  const base: EndpointDef = {
    name: 'ninebox-employee',
    csharpPath: '/ninebox/employee/{id}?period=2026-Q1',
    tsProcedure: 'ninebox.getEmployeeDetail',
    input: { userId: ID_SENTINEL, period: '2026-Q1' },
    idScopeKey: 'employee',
    expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
  };

  it('replaces the {id} sentinel in the csharpPath (url-encoded), preserving query params', () => {
    const out = substituteEndpointId(base, 'aaaa-bbbb');
    expect(out.csharpPath).toBe('/ninebox/employee/aaaa-bbbb?period=2026-Q1');
  });

  it('replaces a mid-path {id} segment (e.g. axis-breakdown)', () => {
    const ep = { ...base, csharpPath: '/ninebox/employee/{id}/axis-breakdown?period=2026-Q1' };
    const out = substituteEndpointId(ep, '123');
    expect(out.csharpPath).toBe('/ninebox/employee/123/axis-breakdown?period=2026-Q1');
  });

  it('replaces the {id} sentinel value inside input with the RAW id (not url-encoded)', () => {
    const out = substituteEndpointId(base, 'e0000360-0000-4000-8000-00000000000a');
    expect(out.input).toEqual({ userId: 'e0000360-0000-4000-8000-00000000000a', period: '2026-Q1' });
  });

  it('substitutes a differently-named input key (e.g. cycleId) that carries the sentinel', () => {
    const ep: EndpointDef = {
      ...base,
      csharpPath: '/evaluation360/cycles/{id}/progress',
      input: { cycleId: ID_SENTINEL },
    };
    const out = substituteEndpointId(ep, 'cyc-1');
    expect(out.csharpPath).toBe('/evaluation360/cycles/cyc-1/progress');
    expect(out.input).toEqual({ cycleId: 'cyc-1' });
  });

  it('url-encodes a path id but leaves the input id raw', () => {
    const ep: EndpointDef = { ...base, csharpPath: '/x/{id}', input: { id: ID_SENTINEL } };
    const out = substituteEndpointId(ep, 'a b/c');
    expect(out.csharpPath).toBe('/x/a%20b%2Fc');
    expect(out.input).toEqual({ id: 'a b/c' });
  });

  it('does not mutate the original endpoint', () => {
    const ep: EndpointDef = { ...base, input: { userId: ID_SENTINEL, period: '2026-Q1' } };
    const snapshot = JSON.stringify(ep);
    substituteEndpointId(ep, 'zzz');
    expect(JSON.stringify(ep)).toBe(snapshot);
  });

  it('leaves an endpoint without any sentinel unchanged (idempotent-shaped)', () => {
    const ep: EndpointDef = {
      name: 'plain',
      csharpPath: '/billing/usage',
      tsProcedure: 'billing.getUsage',
      input: {},
      expectedByRole: { super_admin: 200 },
    };
    const out = substituteEndpointId(ep, 'unused');
    expect(out.csharpPath).toBe('/billing/usage');
    expect(out.input).toEqual({});
  });
});
