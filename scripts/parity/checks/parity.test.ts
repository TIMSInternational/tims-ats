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

  // 2026-08-05 (#59): `tsProcedure` is optional — absent = the TS procedure was deleted, so there is
  // only ONE implementation and a "parity" verdict is meaningless. cli.ts skips such endpoints with a
  // loud NOT-RUN line, but a direct caller must not get a green: fail closed, and never call the TS
  // side with an undefined procedure name.
  it('ok:false and does NOT call the TS side when the endpoint has no tsProcedure', async () => {
    const { tsProcedure: _deleted, ...tsLess } = ep;
    let tsCalled = false;
    const r = await runParityEndpoint(
      tsLess,
      async () => ({ status: 200, body: { a: 1 } }),
      async () => {
        tsCalled = true;
        return { a: 1 };
      },
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no tsProcedure');
    expect(tsCalled).toBe(false);
  });
});
