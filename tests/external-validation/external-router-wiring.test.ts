import { describe, it, expect } from 'vitest';
import { externalRouter } from '../../packages/api/src/routers/external';

// tRPC v11 introspection: router._def.procedures is the flat Record<string, Procedure>
// (mirrored at ._def.record); each procedure's type lives at proc._def.type
// ('query' | 'mutation' | 'subscription') — there is no proc._def.mutation boolean
// in this version. Confirmed by inspecting the existing query procedures' _def shape.
describe('external router — submitValidationResult wiring', () => {
  it('exposes submitValidationResult as a mutation', () => {
    const procs = (externalRouter as unknown as {
      _def: { procedures: Record<string, { _def: { type?: string; mutation?: boolean } }> };
    })._def.procedures;
    const proc = procs['submitValidationResult'];
    expect(proc).toBeDefined();
    const def = proc._def;
    expect(def.type === 'mutation' || def.mutation === true).toBe(true);
  });
});
