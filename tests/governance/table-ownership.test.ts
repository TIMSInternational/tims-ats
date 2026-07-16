import { describe, it, expect } from 'vitest';
import { checkOwnership, checkRepo } from '../../scripts/table-ownership.mjs';

// WP1.7 — the table-ownership ledger CI check. Proves it (a) passes on the real repo and
// (b) BITES a crafted cross-owner PR (docs/architecture/table-ownership.md).

describe('table-ownership ledger check', () => {
  it('passes on the real repository (Prisma owns all product tables; only widgets is EF)', () => {
    expect(checkRepo()).toEqual([]);
  });

  it('flags a cross-owner collision (a table claimed by EF that Prisma also @@maps)', () => {
    const violations = checkOwnership({
      efcore: ['candidate'],
      prismaTables: ['candidate', 'vacancy'],
      efcoreTables: ['candidate'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('cross-owner collision');
    expect(violations[0]).toContain('candidate');
  });

  it('flags an EF-mapped table not registered in the ledger', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      prismaTables: ['candidate'],
      efcoreTables: ['widgets', 'employee_profile'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('unregistered EF table');
    expect(violations[0]).toContain('employee_profile');
  });

  it('is clean when EF and Prisma ownership sets are disjoint and registered', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      prismaTables: ['candidate', 'vacancy'],
      efcoreTables: ['widgets'],
    });
    expect(violations).toEqual([]);
  });
});
