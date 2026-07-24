import { describe, it, expect } from 'vitest';
import { runParityEndpoint } from './checks/parity';
import { assertIsolated } from './checks/rls';
import { verdictForRole } from './checks/rbac';

const ep = {
  name: 'k',
  csharpPath: '/k',
  tsProcedure: 't',
  input: {},
  expectedByRole: { a: 200 as const },
};

describe('harness self-test (green must mean something)', () => {
  it('parity goes RED on an injected field mismatch', async () => {
    const r = await runParityEndpoint(
      ep,
      async () => ({ status: 200, body: { x: 'WRONG' } }),
      async () => ({ x: 'right' })
    );
    expect(r.ok).toBe(false);
  });

  it('rls goes RED when cross-tenant data is returned', () => {
    expect(assertIsolated({ status: 200, body: { id: 'leak' } }).ok).toBe(false);
  });

  it('rbac goes RED on privilege escalation', () => {
    expect(verdictForRole('denied', 403, 200).ok).toBe(false);
  });
});
