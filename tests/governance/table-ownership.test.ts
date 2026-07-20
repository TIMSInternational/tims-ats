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

  it('allows an append-only EF mapping of a Prisma-owned table (WP2.7 audit writer, no collision)', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      efcoreAppendOnly: ['data_access_logs'],
      prismaTables: ['data_access_logs', 'candidate'],
      efcoreTables: ['widgets', 'data_access_logs'],
    });
    expect(violations).toEqual([]);
  });

  it('flags an append-only mapping of a table Prisma does not own', () => {
    const violations = checkOwnership({
      efcore: [],
      efcoreAppendOnly: ['ghost_log'],
      prismaTables: ['data_access_logs'],
      efcoreTables: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('append-only mapping of a non-Prisma table');
    expect(violations[0]).toContain('ghost_log');
  });

  it('allows a strangler-write EF mapping of a Prisma-owned table (Slice 2 vendor write, no collision)', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      efcoreStranglerWrite: ['preemployment_validations'],
      prismaTables: ['preemployment_validations', 'candidate'],
      efcoreTables: ['widgets', 'preemployment_validations'],
    });
    expect(violations).toEqual([]);
  });

  it('flags a strangler-write mapping of a table Prisma does not own', () => {
    const violations = checkOwnership({
      efcore: [],
      efcoreStranglerWrite: ['ghost_validation'],
      prismaTables: ['preemployment_validations'],
      efcoreTables: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('strangler-write mapping of a non-Prisma table');
    expect(violations[0]).toContain('ghost_validation');
  });

  it('does NOT treat a strangler-write table as a cross-owner collision (Prisma still owns the DDL)', () => {
    // preemployment_validations is @@map'd in Prisma AND EF-mapped for the vendor write — this must be
    // clean, proving efcoreStranglerWrite is the honest middle category (efcore WOULD collide).
    const collision = checkOwnership({
      efcore: ['preemployment_validations'],
      prismaTables: ['preemployment_validations'],
      efcoreTables: ['preemployment_validations'],
    });
    expect(collision).toHaveLength(1);
    expect(collision[0]).toContain('cross-owner collision');

    const stranglerWrite = checkOwnership({
      efcore: [],
      efcoreStranglerWrite: ['preemployment_validations'],
      prismaTables: ['preemployment_validations'],
      efcoreTables: ['preemployment_validations'],
    });
    expect(stranglerWrite).toEqual([]);
  });

  it('allows quartzInfra tables owned by neither ORM (Phase-4 Slice-2 scheduler infra)', () => {
    const violations = checkOwnership({
      efcore: ['widgets'],
      quartzInfra: ['qrtz_triggers', 'qrtz_locks'],
      prismaTables: ['candidate'],
      efcoreTables: ['widgets'],
    });
    expect(violations).toEqual([]);
  });

  it('flags a quartzInfra table that Prisma @@maps (an ORM must not claim scheduler infra)', () => {
    const violations = checkOwnership({
      efcore: [],
      quartzInfra: ['qrtz_triggers'],
      prismaTables: ['qrtz_triggers', 'candidate'],
      efcoreTables: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('quartz-infra table claimed by Prisma');
    expect(violations[0]).toContain('qrtz_triggers');
  });

  it('flags a quartzInfra table that an EF DbContext .ToTable maps', () => {
    // Wrongly .ToTable'ing a qrtz table trips BOTH guards: the quartz-infra claim AND the
    // unregistered-EF-table check (it is in no EF ownership list) — both are true violations.
    const violations = checkOwnership({
      efcore: ['widgets'],
      quartzInfra: ['qrtz_locks'],
      prismaTables: ['candidate'],
      efcoreTables: ['widgets', 'qrtz_locks'],
    });
    expect(violations.some((v) => v.includes('quartz-infra table claimed by EF') && v.includes('qrtz_locks'))).toBe(
      true,
    );
  });

  it('does NOT treat an append-only table as a cross-owner collision (Prisma still owns the DDL)', () => {
    // data_access_logs is @@map'd in Prisma AND EF-mapped for appends — this must be clean,
    // proving efcoreAppendOnly is the honest middle category (not efcore, which WOULD collide).
    const collision = checkOwnership({
      efcore: ['data_access_logs'],
      prismaTables: ['data_access_logs'],
      efcoreTables: ['data_access_logs'],
    });
    expect(collision).toHaveLength(1);
    expect(collision[0]).toContain('cross-owner collision');

    const appendOnly = checkOwnership({
      efcore: [],
      efcoreAppendOnly: ['data_access_logs'],
      prismaTables: ['data_access_logs'],
      efcoreTables: ['data_access_logs'],
    });
    expect(appendOnly).toEqual([]);
  });
});
