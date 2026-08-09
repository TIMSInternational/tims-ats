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
    // the three public token procedures stay publicProcedure and probe-free.
    // Asserted over EACH of the three by name, not over one block: bounding
    // `getBySigningToken` at its next sibling drops acceptByToken (:129) and
    // declineByToken (:230), and nothing else in the suite covers them. A negative
    // assertion is only as strong as the region it spans, so narrowing one silently
    // removes coverage — the inverse of the hollow-slice defect, and the reason this
    // conversion is not a mechanical `blockAt` swap.
    expect(src).toMatch(/getBySigningToken:\s*publicProcedure/);
    for (const proc of ['getBySigningToken:', 'acceptByToken:', 'declineByToken:']) {
      expect(blockAt(src, proc, { minLines: 5 })).not.toMatch(/assertScoped|scopeWhereFor/);
    }
  });

  it('no scope-fragment spreads', () => {
    for (const f of ['crud.ts', 'approvals.ts', 'lifecycle.ts', 'validations.ts', 'signing.ts']) {
      expect(read(f)).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
    }
  });
});
