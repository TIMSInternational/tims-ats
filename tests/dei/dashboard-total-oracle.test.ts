import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for getDashboardKpis.totalResponses oracle (slice 6 round 8) ──
// The engagement dashboard published the exact org-wide surveyResponse total when
// >=5. The per-survey endpoint (getSurveyResults) suppresses any survey with a 1..4
// response count, so a caller could sum the visible (>=5) survey totals and subtract
// from the org total to recover a single suppressed survey's 1..4 count. The dashboard
// must share the per-survey all-or-nothing trigger: when ANY individual survey has a
// 1..4 response count, totalResponses is nulled (+ totalResponsesSuppressed:true), even
// though the org total itself is >=5.

const surveyCount = vi.fn();
const surveyResponseCount = vi.fn();
const surveyResponseGroupBy = vi.fn();
const actionPlanCount = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    survey: { count: (...a: unknown[]) => surveyCount(...a) },
    surveyResponse: {
      count: (...a: unknown[]) => surveyResponseCount(...a),
      groupBy: (...a: unknown[]) => surveyResponseGroupBy(...a),
    },
    actionPlan: { count: (...a: unknown[]) => actionPlanCount(...a) },
  },
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>(
    '../../packages/api/src/access',
  );
  return {
    ...actual,
    requireOrgScope: vi.fn(),
    assertScoped: vi.fn(),
    assertSubjectInScope: vi.fn(),
    scopeWhereFor: vi.fn(async () => ({})),
  };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
  return { router: t.router, permissionProcedure: () => t.procedure };
});

import { engagementRouter } from '../../packages/api/src/routers/engagement';

interface DashKpis {
  activeSurveys: number;
  totalResponses: number | null;
  totalResponsesSuppressed: boolean;
  actionPlansOpen: number;
  highRiskCount: number;
}
interface DashCaller {
  getDashboardKpis(): Promise<DashKpis>;
}

const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
const createCaller = t.createCallerFactory(engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const ctx = { user: { organizationId: 'org-1', id: 'u-1' }, access: {} };
const caller = () => createCaller(ctx) as unknown as DashCaller;

const group = (surveyId: string, n: number) => ({ surveyId, _count: { _all: n } });

beforeEach(() => {
  vi.clearAllMocks();
  surveyCount.mockResolvedValue(2);
  actionPlanCount.mockResolvedValue(0);
});

describe('getDashboardKpis totalResponses differencing oracle', () => {
  it('nulls totalResponses when a survey has 3 responses even though the org total is >=5', async () => {
    // org total = 15 (>=5, passes its own floor) but one survey has only 3 responses.
    surveyResponseCount.mockResolvedValue(15);
    surveyResponseGroupBy.mockResolvedValue([group('s1', 12), group('s2', 3)]);

    const r = await caller().getDashboardKpis();

    expect(r.totalResponsesSuppressed).toBe(true);
    expect(r.totalResponses).toBeNull();
    // non-respondent counts are unaffected.
    expect(r.activeSurveys).toBe(2);
  });

  it('returns the real total when every survey is at or above the floor', async () => {
    surveyResponseCount.mockResolvedValue(17);
    surveyResponseGroupBy.mockResolvedValue([group('s1', 12), group('s2', 5)]);

    const r = await caller().getDashboardKpis();

    expect(r.totalResponsesSuppressed).toBe(false);
    expect(r.totalResponses).toBe(17);
  });

  it('still suppresses when the org total itself is 1..4 (existing floor)', async () => {
    surveyResponseCount.mockResolvedValue(3);
    surveyResponseGroupBy.mockResolvedValue([group('s1', 3)]);

    const r = await caller().getDashboardKpis();

    expect(r.totalResponsesSuppressed).toBe(true);
    expect(r.totalResponses).toBeNull();
  });

  it('passes through 0 responses unsuppressed (reveals no individual)', async () => {
    surveyResponseCount.mockResolvedValue(0);
    surveyResponseGroupBy.mockResolvedValue([]);

    const r = await caller().getDashboardKpis();

    expect(r.totalResponsesSuppressed).toBe(false);
    expect(r.totalResponses).toBe(0);
  });
});
