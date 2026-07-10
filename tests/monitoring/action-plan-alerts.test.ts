import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Sprint 1.4 Task 3: monitoring.getActionPlanAlerts ────────────────────────
// Overdue (or ≤14-days-out) Climate ActionPlans surfaced on the exec Monitoring
// dashboard. This is a NEW cross-module read: ActionPlan CRUD lives in
// engagement.ts, this query only reads it.
//
// Acceptance criteria under test:
//   1. An overdue (or ≤14-days-out) ActionPlan appears.
//   2. One 30 days out does NOT appear — until its dueDate moves inside the
//      14-day window.
//   3. A `completed` one never appears, regardless of dueDate.

const actionPlanFindMany = vi.fn();
const scopeWhereForMock = vi.fn();

// Codex finding: getActionPlanAlerts previously filtered only by organizationId,
// unlike its sibling engagement.listActionPlans (which composes a
// scopeWhereFor('actionPlan', ...) fragment). monitoring:read is granted to
// hrbp at UNIT scope (seed-access-matrix.ts) — a unit-scoped caller must not
// see org-wide action plans. Mock scopeWhereFor to return a DISTINCTIVE
// fragment so we can assert it flows into the Prisma `where` unchanged.
const SCOPE_FRAGMENT = { __scopeMarker: 'unit-scope-fragment' };

vi.mock('@tims/db', () => ({
  tenantDb: {
    actionPlan: {
      findMany: (...a: unknown[]) => actionPlanFindMany(...a),
    },
  },
}));

vi.mock('../../packages/api/src/access', () => ({
  scopeWhereFor: (...a: unknown[]) => scopeWhereForMock(...a),
  suppressBelowMin5: (n: number) => ({ count: n, suppressed: false }),
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { organizationId: string; id: string }; access: { roles: string[] }; headers: Headers }>()
    .create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { monitoringRouter } from '../../packages/api/src/routers/monitoring';

const t = initTRPC
  .context<{ user: { organizationId: string; id: string }; access: { roles: string[] }; headers: Headers }>()
  .create();

const factory = t.createCallerFactory(monitoringRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

const caller = () =>
  factory({ user: { organizationId: 'org-1', id: 'u-1' }, access: { roles: ['hr_admin'] }, headers: new Headers() }) as unknown as {
    getActionPlanAlerts(): Promise<{
      items: Array<{
        id: string;
        title: string;
        area: string | null;
        status: string;
        dueDate: string | Date | null;
        responsible: { id: string; firstName: string; lastName: string; avatar: string | null };
      }>;
      total: number;
    }>;
  };

function actionPlan(overrides: Partial<{
  id: string;
  title: string;
  area: string | null;
  status: string;
  dueDate: Date | null;
}> = {}) {
  return {
    id: 'ap-1',
    title: 'Improve manager 1:1 cadence',
    area: 'Leadership',
    status: 'pending',
    dueDate: new Date(),
    responsible: { id: 'user-1', firstName: 'Ana', lastName: 'Gomez', avatar: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeWhereForMock.mockResolvedValue(SCOPE_FRAGMENT);
});

describe('monitoring.getActionPlanAlerts', () => {
  it('returns overdue and due-within-14-days ActionPlans, excludes completed and far-out ones', async () => {
    // The query itself only filters by organizationId/status/dueDate <= horizon
    // — simulate what the (mocked) DB would already have filtered, and assert
    // the shape/pass-through is correct.
    actionPlanFindMany.mockResolvedValue([
      actionPlan({ id: 'ap-overdue', dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }),
      actionPlan({ id: 'ap-soon', dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) }),
    ]);

    const result = await caller().getActionPlanAlerts();

    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.id)).toEqual(['ap-overdue', 'ap-soon']);

    // Assert the query itself asks Prisma for exactly the right filter shape
    // (AND-composed: organizationId, the scope fragment, then the alert filters —
    // same pattern as engagement.ts's listActionPlans).
    const call = actionPlanFindMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ organizationId: 'org-1' });
    expect(call.where.AND[2].status).toEqual({ not: 'completed' });
    expect(call.where.AND[2].dueDate.lte).toBeInstanceOf(Date);

    // The horizon must be ~14 days out (not 30, not 0).
    const horizon = call.where.AND[2].dueDate.lte as Date;
    const daysOut = (horizon.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(13.9);
    expect(daysOut).toBeLessThan(14.1);
  });

  it('a 30-days-out ActionPlan is excluded by the query filter (not returned by the mocked DB call)', async () => {
    // Simulate the real Prisma behavior: a plan 30 days out would NOT satisfy
    // `dueDate: { lte: horizon }` where horizon is now+14d, so the (mocked) DB
    // layer returns nothing for it.
    actionPlanFindMany.mockResolvedValue([]);

    const result = await caller().getActionPlanAlerts();

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('a completed ActionPlan is excluded regardless of dueDate (query filters status != completed)', async () => {
    // Same reasoning: `status: { not: 'completed' }` means the mocked DB call
    // would never surface a completed row even if overdue.
    actionPlanFindMany.mockResolvedValue([
      actionPlan({ id: 'ap-active-only', status: 'in_progress' }),
    ]);

    const result = await caller().getActionPlanAlerts();

    expect(result.items.map((i) => i.id)).toEqual(['ap-active-only']);
    expect(result.items.every((i) => i.status !== 'completed')).toBe(true);

    const call = actionPlanFindMany.mock.calls[0][0];
    expect(call.where.AND[2].status).toEqual({ not: 'completed' });
  });

  it('composes scopeWhereFor(actionPlan) into the where clause — unit-scoped hrbp callers must not see org-wide plans (Codex finding)', async () => {
    actionPlanFindMany.mockResolvedValue([]);
    await caller().getActionPlanAlerts();

    // scopeWhereFor is called for the 'actionPlan' entity with the caller's
    // access context and user id — same signature engagement.ts's
    // listActionPlans uses.
    expect(scopeWhereForMock).toHaveBeenCalledWith('actionPlan', { roles: ['hr_admin'] }, 'u-1');

    // Its (distinctive, mocked) result must flow, unmodified, into the AND
    // clause sent to Prisma — never dropped or spread away.
    const call = actionPlanFindMany.mock.calls[0][0];
    expect(call.where.AND).toContainEqual(SCOPE_FRAGMENT);
  });

  it('orders by dueDate ascending (most urgent first)', async () => {
    actionPlanFindMany.mockResolvedValue([]);
    await caller().getActionPlanAlerts();

    const call = actionPlanFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ dueDate: 'asc' });
  });

  it('selects only the fields needed (no full-record leak), including responsible avatar/name', async () => {
    actionPlanFindMany.mockResolvedValue([]);
    await caller().getActionPlanAlerts();

    const call = actionPlanFindMany.mock.calls[0][0];
    expect(call.select).toEqual({
      id: true,
      title: true,
      area: true,
      status: true,
      dueDate: true,
      responsible: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
    });
  });
});
