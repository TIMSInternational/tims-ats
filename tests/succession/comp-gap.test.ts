import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sprint 1.4 Task 4 — Compensation <-> Succession readiness check.
// getCompGapAlerts (read-only): for each `ready_now` Successor on a Critical
// Role that has a `targetBandLevel` set, compare their current compensation
// against the matching SalaryBand's midSalary. Flag when
// currentSalary < midSalary * 0.9. A Successor with no EmployeeCompensation
// row must be skipped, never crash the query.
//
// §21 hardening (post-whole-branch-review): employeeCompensation.currentSalary
// is restricted data — this endpoint must ALSO hold compensation:read (a
// secondary in-body check via buildAccessForUser, same pattern as
// vacancy/crud.ts's create mutation checking vacancy:publish beyond its own
// procedure gate), must build its employeeCompensation select via
// selectFor(...) (real implementation kept below, only the DB-touching
// scope/audit/permission helpers are mocked), and must log one
// data_access_logs row per EXPOSED alert record via logDataAccess.
//
// updateCriticalRoleBand (write): a single-field mutation setting
// CriticalRole.targetBandLevel — NOT a general CriticalRole editor.

const criticalRoleFindMany = vi.fn();
const criticalRoleUpdate = vi.fn();
const salaryBandFindMany = vi.fn();
const employeeCompensationFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    criticalRole: {
      findMany: (...a: unknown[]) => criticalRoleFindMany(...a),
      update: (...a: unknown[]) => criticalRoleUpdate(...a),
    },
    salaryBand: { findMany: (...a: unknown[]) => salaryBandFindMany(...a) },
    employeeCompensation: {
      findMany: (...a: unknown[]) => employeeCompensationFindMany(...a),
    },
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
}));

// buildAccessForUser toggled per-test via setCompensationReadAllowed (mirrors
// tests/vacancy/create-autopublish.test.ts's publishAllowed pattern) so the
// FORBIDDEN path can be exercised without a real rolePermission/DB lookup.
const compensationReadAllowed = vi.hoisted(() => ({ value: true }));
function setCompensationReadAllowed(value: boolean) {
  compensationReadAllowed.value = value;
}
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async (_user: unknown, _module: string, _action: string) =>
    compensationReadAllowed.value
      ? { allowed: true, scope: 'organization', roles: ['hr_admin'] }
      : { allowed: false },
  ),
);
const logDataAccessMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// scopeWhereFor is toggled per-test so we can assert getCompGapAlerts APPLIES the
// employeeCompensation ROW scope (not just the field-level selectFor). Defaults to {}
// (org/company scope → no-op AND). A narrow comp scope returns a userId fragment.
const scopeWhereForMock = vi.hoisted(() =>
  vi.fn(async (_entity: string, _access: unknown, _userId: string) => ({}) as unknown),
);

vi.mock('../../packages/api/src/access', async () => {
  // Keep the REAL selectFor + classification so the employeeCompensation
  // field-level projection (currentSalary/currency) is exercised end-to-end,
  // same approach as tests/dei/comp-field-auth.test.ts. Only the DB-touching
  // scope/permission/audit helpers are replaced.
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return {
    ...actual,
    buildAccessForUser: buildAccessForUserMock,
    createAnchorLoader: vi.fn().mockReturnValue(null),
    assertScoped: vi.fn().mockResolvedValue(undefined),
    assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
    requireOrgScope: vi.fn(),
    logDataAccess: logDataAccessMock,
    scopeWhereFor: scopeWhereForMock,
  };
});

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ROLE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function roleRow(overrides: Partial<{
  id: string;
  title: string;
  targetBandLevel: string | null;
  successors: Array<{ id: string; userId: string; readiness: string; user: { id: string; firstName: string; lastName: string; avatar: string | null } }>;
}> = {}) {
  return {
    id: ROLE_ID,
    title: 'VP Engineering',
    targetBandLevel: 'L5',
    successors: [
      {
        id: 'successor-1',
        userId: 'user-1',
        readiness: 'ready_now',
        user: { id: 'user-1', firstName: 'Ana', lastName: 'Gomez', avatar: null },
      },
    ],
    ...overrides,
  };
}

function bandRow(overrides: Partial<{ level: string; midSalary: number }> = {}) {
  return { id: 'band-1', organizationId: ORG_ID, level: 'L5', title: null, minSalary: 80000, midSalary: 100000, maxSalary: 120000, currency: 'USD', isActive: true, ...overrides };
}

function compRow(overrides: Partial<{ id: string; userId: string; currentSalary: number }> = {}) {
  return { id: 'comp-1', organizationId: ORG_ID, userId: 'user-1', currentSalary: 100000, currency: 'USD', compaRatio: null, bandId: null, variablePay: null, effectiveDate: new Date('2026-01-01'), ...overrides };
}

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { successionRouter } = await import('../../packages/api/src/routers/succession');
  const testRouter = router({ succession: successionRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-caller', organizationId: ORG_ID, roles: ['hr_admin'],
      isPlatformOwner: false, impersonatorId: null, email: 'hr@tims.co', isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    succession: {
      getCompGapAlerts(): Promise<
        Array<{
          successorId: string;
          roleId: string;
          roleTitle: string;
          userId: string;
          currentSalary: number;
          midSalary: number;
          bandLevel: string;
          gapPercent: number;
        }>
      >;
      updateCriticalRoleBand(input: { criticalRoleId: string; targetBandLevel: string | null }): Promise<{
        id: string;
        targetBandLevel: string | null;
      }>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setCompensationReadAllowed(true);
  // Default: org/company comp scope → scopeWhereFor returns {} (AND no-op).
  scopeWhereForMock.mockResolvedValue({});
});

describe('succession.getCompGapAlerts', () => {
  it('flags a ready_now successor well below the target band midpoint (< 0.9x)', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 80000 })]); // 0.8x

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      successorId: 'successor-1',
      roleId: ROLE_ID,
      userId: 'user-1',
      currentSalary: 80000,
      midSalary: 100000,
      bandLevel: 'L5',
    });
  });

  it('does not flag a successor at or above the 0.9x threshold', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 95000 })]); // 0.95x

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(0);
  });

  it('is right at the threshold boundary (0.9x exactly) — not flagged (strict <)', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 90000 })]); // exactly 0.9x

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(0);
  });

  it('does not crash and simply skips a successor with no EmployeeCompensation row', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([]); // no comp row at all

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(0);
  });

  it('skips roles with no targetBandLevel set (query pre-filters, but be defensive)', async () => {
    criticalRoleFindMany.mockResolvedValue([]);
    salaryBandFindMany.mockResolvedValue([]);
    employeeCompensationFindMany.mockResolvedValue([]);

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(0);
    // Query itself must filter on targetBandLevel not null, not fetch every role.
    expect(criticalRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetBandLevel: { not: null } }),
      }),
    );
  });

  it('skips a role whose targetBandLevel has no matching active SalaryBand (soft-match miss)', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow({ targetBandLevel: 'L99' })]);
    salaryBandFindMany.mockResolvedValue([]); // no band matches L99
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 1 })]);

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(0);
  });

  it('filters successors to readiness=ready_now at the query level (DB-side, not in-app re-filtering), via explicit select (not include)', async () => {
    // A real Prisma query with `where: { readiness: 'ready_now' }` on the
    // nested `successors` relation would never RETURN a ready_1_year row in
    // the first place — so the mock here returns an empty successors array
    // (simulating what the DB filter would produce), and the meaningful
    // assertion is that the router actually sent that where clause, via an
    // explicit `select` (Finding 3: never `include`, which would over-fetch
    // every scalar column including Successor.developmentPlan).
    criticalRoleFindMany.mockResolvedValue([roleRow({ successors: [] })]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([]);

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    const call = criticalRoleFindMany.mock.calls[0]![0] as { select: Record<string, unknown>; include?: unknown };
    expect(call.include).toBeUndefined();
    expect(call.select).toEqual(
      expect.objectContaining({
        id: true,
        title: true,
        targetBandLevel: true,
        successors: expect.objectContaining({
          where: expect.objectContaining({ readiness: 'ready_now' }),
          select: expect.objectContaining({ id: true, userId: true }),
        }),
      }),
    );
    expect(result).toHaveLength(0);
  });

  it('throws FORBIDDEN and runs no query when the caller lacks compensation:read', async () => {
    setCompensationReadAllowed(false);
    const caller = await makeCaller();

    await expect(caller.succession.getCompGapAlerts()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(criticalRoleFindMany).not.toHaveBeenCalled();
    expect(employeeCompensationFindMany).not.toHaveBeenCalled();
  });

  it('builds the employeeCompensation select via selectFor (currentSalary/currency only leave the DB for an entitled role)', async () => {
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 80000 })]);

    const caller = await makeCaller();
    await caller.succession.getCompGapAlerts();

    const call = employeeCompensationFindMany.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(call.select.currentSalary).toBe(true);
    expect(call.select.currency).toBe(true);
    // compaRatio/variablePay/bandId are HR-analytics restricted fields this
    // endpoint never reads — selectFor must not smuggle them in.
    expect(call.select.compaRatio).toBeUndefined();
    expect(call.select.variablePay).toBeUndefined();
    expect(call.select.bandId).toBeUndefined();
  });

  // Codex hardening bite — the employeeCompensation ROW scope must be AND-composed
  // into the comp query, so a caller with org-wide succession:read but NARROW
  // compensation:read cannot read org-wide salary comp-gaps.
  it('AND-composes the employeeCompensation scope fragment for a NARROW comp scope (never a spread)', async () => {
    // A narrow comp scope resolves to a userId-narrowing fragment.
    const narrowFragment = { userId: { in: ['user-1'] } };
    scopeWhereForMock.mockResolvedValue(narrowFragment);
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 80000 })]);

    const caller = await makeCaller();
    await caller.succession.getCompGapAlerts();

    // scopeWhereFor was consulted for the employeeCompensation entity.
    expect(scopeWhereForMock).toHaveBeenCalledWith(
      'employeeCompensation',
      expect.objectContaining({ scope: 'organization', roles: ['hr_admin'] }),
      'user-caller',
    );
    const call = employeeCompensationFindMany.mock.calls[0]![0] as {
      where: { organizationId: string; AND: unknown[] };
    };
    // The where MUST AND the userId-narrowing base with the scope fragment — not spread.
    expect(call.where.AND).toEqual([{ userId: { in: ['user-1'] } }, narrowFragment]);
    // The base userId key must live INSIDE the AND, never spread at the top level
    // (a spread would collide with the scope fragment's own userId key).
    expect((call.where as Record<string, unknown>).userId).toBeUndefined();
  });

  it('applies an empty AND fragment at ORG/COMPANY comp scope (no over-restriction, behavior-identical)', async () => {
    // Org/company scope → scopeWhereFor returns {} → the AND is a semantic no-op.
    scopeWhereForMock.mockResolvedValue({});
    criticalRoleFindMany.mockResolvedValue([roleRow()]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([compRow({ currentSalary: 80000 })]);

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    const call = employeeCompensationFindMany.mock.calls[0]![0] as {
      where: { AND: unknown[] };
    };
    expect(call.where.AND).toEqual([{ userId: { in: ['user-1'] } }, {}]);
    // The alert still fires (org-scope comp read is unrestricted).
    expect(result).toHaveLength(1);
  });

  it('logs a data-access audit entry once per EXPOSED alert record (not per row queried)', async () => {
    const role = roleRow({
      successors: [
        { id: 'successor-1', userId: 'user-1', readiness: 'ready_now', user: { id: 'user-1', firstName: 'Ana', lastName: 'Gomez', avatar: null } },
        { id: 'successor-2', userId: 'user-2', readiness: 'ready_now', user: { id: 'user-2', firstName: 'Beto', lastName: 'Diaz', avatar: null } },
      ],
    });
    criticalRoleFindMany.mockResolvedValue([role]);
    salaryBandFindMany.mockResolvedValue([bandRow({ midSalary: 100000 })]);
    employeeCompensationFindMany.mockResolvedValue([
      compRow({ id: 'comp-1', userId: 'user-1', currentSalary: 80000 }), // 0.8x — flagged
      compRow({ id: 'comp-2', userId: 'user-2', currentSalary: 95000 }), // 0.95x — NOT flagged
    ]);

    const caller = await makeCaller();
    const result = await caller.succession.getCompGapAlerts();

    expect(result).toHaveLength(1);
    expect(logDataAccessMock).toHaveBeenCalledTimes(1);
    expect(logDataAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        entity: 'employeeCompensation',
        recordId: 'comp-1',
        action: 'read',
      }),
    );
  });
});

describe('succession.updateCriticalRoleBand', () => {
  it('updates only targetBandLevel, scoped to the caller org', async () => {
    criticalRoleUpdate.mockResolvedValue({ id: ROLE_ID, targetBandLevel: 'L5' });

    const caller = await makeCaller();
    const result = await caller.succession.updateCriticalRoleBand({
      criticalRoleId: ROLE_ID,
      targetBandLevel: 'L5',
    });

    expect(result).toEqual({ id: ROLE_ID, targetBandLevel: 'L5' });
    expect(criticalRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROLE_ID, organizationId: ORG_ID },
        data: { targetBandLevel: 'L5' },
      }),
    );
  });

  it('allows clearing the band by passing null', async () => {
    criticalRoleUpdate.mockResolvedValue({ id: ROLE_ID, targetBandLevel: null });

    const caller = await makeCaller();
    const result = await caller.succession.updateCriticalRoleBand({
      criticalRoleId: ROLE_ID,
      targetBandLevel: null,
    });

    expect(result.targetBandLevel).toBeNull();
  });
});
