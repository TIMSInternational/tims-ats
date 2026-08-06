import { describe, it, expect } from 'vitest';
import { runParityEndpoint } from './parity';

const ep = {
  name: 'k',
  csharpPath: '/k',
  tsProcedure: 't.k',
  input: {},
  expectedByRole: { org_admin: 200 as const },
  normalize: { dropNullish: true },
};

// A C#-only endpoint: the TS side of its surface was deleted (nine-box reads, #57), so there is
// nothing to diff against. `tsProcedure` is absent rather than the endpoint being removed, because
// the rls/rbac checks still probe it and are the only automated cross-tenant coverage it has.
const csharpOnlyEp = { ...ep, tsProcedure: undefined };

describe('runParityEndpoint — C#-only endpoint (no tsProcedure)', () => {
  it('never calls the TS side', async () => {
    let tsCalls = 0;
    await runParityEndpoint(
      csharpOnlyEp,
      async () => ({ status: 200, body: { a: 1 } }),
      async () => {
        tsCalls++;
        return {};
      },
    );
    expect(tsCalls).toBe(0);
  });

  it('reports INCONCLUSIVE, not a bare pass — "nothing to compare" must not render as "the stacks agree"', async () => {
    const r = await runParityEndpoint(
      csharpOnlyEp,
      async () => ({ status: 200, body: { a: 1 } }),
      async () => ({ a: 1 }),
    );
    expect(r.ok).toBe(true);
    expect(r.inconclusive).toBe(true);
    expect(r.detail).toContain('no tsProcedure');
  });

  it('still FAILS when the deployed C# endpoint stops returning 200', async () => {
    const r = await runParityEndpoint(
      csharpOnlyEp,
      async () => ({ status: 500, body: null }),
      async () => ({ a: 1 }),
    );
    expect(r.ok).toBe(false);
    expect(r.inconclusive).toBeUndefined();
    expect(r.detail).toContain('500');
  });
});

describe('runParityEndpoint', () => {
  it('ok when C# == TS after normalize', async () => {
    const r = await runParityEndpoint(
      ep,
      async () => ({ status: 200, body: { a: 1, b: null } }),
      async () => ({ a: 1 }),
    );
    expect(r.ok).toBe(true);
  });

  it('red + diff detail on mismatch', async () => {
    const r = await runParityEndpoint(
      ep,
      async () => ({ status: 200, body: { a: 2 } }),
      async () => ({ a: 1 }),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('a');
  });

  it('ok:false with the status in detail when C# returns a non-200 (TS side not compared)', async () => {
    const r = await runParityEndpoint(
      ep,
      async () => ({ status: 500, body: null }),
      async () => ({ a: 1 }),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('500');
  });
});
