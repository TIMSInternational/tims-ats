import { describe, it, expect } from 'vitest';
import { MODULES, ACTIONS, SCOPES } from '@tims/shared';
import { MATRIX, grantsFor } from '../../packages/db/prisma/seed-access-matrix';

describe('permission vocabulary', () => {
  it('adds the 5 live modules', () => {
    for (const m of ['succession', 'team_intel', 'learning', 'feature_flags', 'notification'])
      expect(MODULES).toContain(m);
  });
  it('MODULES has exactly 23 entries (no phantom additions)', () => {
    expect(MODULES).toHaveLength(23);
  });
  it('drops the 6 dead modules', () => {
    for (const m of ['coaching', 'evaluation', 'commitment', 'talent', 'team', 'lnd'])
      expect(MODULES).not.toContain(m);
  });
  it('adds the publish action', () => {
    expect(ACTIONS).toContain('publish');
  });
  it('ACTIONS has exactly 7 entries (no phantom additions)', () => {
    expect(ACTIONS).toHaveLength(7);
  });
  it('every seeded grant uses a valid module + action (no drift)', () => {
    let tripleCount = 0;
    for (const role of Object.keys(MATRIX))
      for (const g of grantsFor(role)) {
        tripleCount++;
        expect(MODULES, `module ${g.module}`).toContain(g.module);
        expect(ACTIONS, `action ${g.action}`).toContain(g.action);
      }
    expect(tripleCount, 'no-drift invariant must iterate the real grant set').toBeGreaterThan(200);
  });
  it('every seeded grant uses a valid scope (no scope drift)', () => {
    for (const role of Object.keys(MATRIX))
      for (const g of grantsFor(role))
        expect(SCOPES, `scope ${g.scope} for ${role}`).toContain(g.scope);
  });
});
