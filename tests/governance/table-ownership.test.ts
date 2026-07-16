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

  it('allows a read-only EF mapping of a Prisma-owned table (no collision, registered)', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      efcoreReadOnly: ['users', 'api_keys'],
      prismaTables: ['users', 'api_keys', 'candidate'],
      efcoreTables: ['widgets', 'users', 'api_keys'],
    });
    expect(violations).toEqual([]);
  });

  it('flags a read-only mapping of a table Prisma does not own', () => {
    const violations = checkOwnership({
      efcore: [],
      efcoreReadOnly: ['ghost_table'],
      prismaTables: ['users'],
      efcoreTables: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('read-only mapping of a non-Prisma table');
    expect(violations[0]).toContain('ghost_table');
  });

  it('still flags an EF ToTable that is in neither efcore nor efcoreReadOnly', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      efcoreReadOnly: ['users'],
      prismaTables: ['users'],
      efcoreTables: ['widgets', 'users', 'unregistered_tbl'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('unregistered EF table');
    expect(violations[0]).toContain('unregistered_tbl');
  });
});
