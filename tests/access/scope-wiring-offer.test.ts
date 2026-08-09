import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, 'packages/api/src/routers/offer', p), 'utf8');

describe('offer module scope wiring', () => {
  it('crud.ts: list composes scopeWhereFor(offer) in AND; by-id endpoints probed/composed', () => {
    const src = read('crud.ts');
    expect(src).toMatch(/scopeWhereFor\('offer'/);
    expect(src).toMatch(/AND:\s*\[/);
  });

  it('approvals.ts, lifecycle.ts, validations.ts: staff endpoints are scope-guarded', () => {
    for (const f of ['approvals.ts', 'lifecycle.ts', 'validations.ts']) {
      expect(read(f)).toMatch(/assertScoped\('offer'|scopeWhereFor\('offer'/);
    }
  });

  it('signing.ts: generateSigningLink is scope-guarded; PUBLIC token flows untouched', () => {
    const src = read('signing.ts');
    const staffBlock = blockAt(src, 'generateSigningLink:');
    expect(staffBlock).toMatch(/assertScoped\('offer'|scopeWhereFor\('offer'/);
    // the three public token procedures stay publicProcedure and probe-free
    const publicBlock = blockAt(src, 'getBySigningToken:');
    expect(src).toMatch(/getBySigningToken:\s*publicProcedure/);
    expect(publicBlock).not.toMatch(/assertScoped|scopeWhereFor/);
  });

  it('no scope-fragment spreads', () => {
    for (const f of ['crud.ts', 'approvals.ts', 'lifecycle.ts', 'validations.ts', 'signing.ts']) {
      expect(read(f)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});
