import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

// ── Behavioral test for getEnps min-5 suppression (slice 6) ──────────────────
// getEnps returns raw promoter/passive/detractor head-counts. For a period with
// 1..4 eNPS responses those are exact small-group head-counts that re-identify
// individuals. The endpoint must suppress (null) the score + all splits + the
// respondent count below the min-5 floor.
//
// The resolver lives inline in the engagement router, behind the full
// permission/auth/tenant middleware stack. To exercise the RESOLVER behavior
// (not the middleware) we mock `../trpc` so `permissionProcedure` is a bare
// pass-through procedure, mock `@tims/db` (tenantDb), and keep the REAL
// suppressBelowMin5 while no-op'ing requireOrgScope.

const surveyResponseFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    surveyResponse: { findMany: (...a: unknown[]) => surveyResponseFindMany(...a) },
  },
}));

// Real suppressBelowMin5, no-op org gate + write-rule helpers used by the router.
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

// Replace the heavy procedure builders with a bare tRPC procedure so the router
// resolver runs without the auth/tenant/permission/rate-limit middleware.
vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
  return {
    router: t.router,
    permissionProcedure: () => t.procedure,
  };
});

import { engagementRouter } from '../../packages/api/src/routers/engagement';

// getEnps's runtime output shape (post-suppression nullability).
interface EnpsResult {
  enps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  totalResponses: number | null;
  suppressed: boolean;
  period: string;
}
interface EnpsCaller {
  getEnps(input: { period?: 'month' | 'quarter' | 'year' }): Promise<EnpsResult>;
}

// The mocked `../trpc` builds the router with a context shaped { user, access }.
// At type level `engagementRouter` still resolves against the real trpc module, so
// cast through `unknown` for the factory and type the caller via EnpsCaller.
const t = initTRPC.context<{ user: { organizationId: string; id: string }; access: unknown }>().create();
const createCaller = t.createCallerFactory(engagementRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);
const ctx = { user: { organizationId: 'org-1', id: 'u-1' }, access: {} };
const caller = () => createCaller(ctx) as unknown as EnpsCaller;

// A surveyResponse row whose first answer value is the eNPS score.
const resp = (score: number) => ({ answers: { q1: score } });

beforeEach(() => vi.clearAllMocks());

describe('getEnps min-5 suppression', () => {
  it('suppresses score + all splits + count when fewer than 5 responses', async () => {
    // 4 responses (1..4) → must be suppressed.
    surveyResponseFindMany.mockResolvedValue([resp(10), resp(9), resp(3), resp(7)]);
    const r = await caller().getEnps({ period: 'quarter' });

    expect(r.suppressed).toBe(true);
    expect(r.enps).toBeNull();
    expect(r.promoters).toBeNull();
    expect(r.passives).toBeNull();
    expect(r.detractors).toBeNull();
    // The respondent count is itself a <5 head-count — it must not leak either.
    expect(r.totalResponses).toBeNull();
  });

  it('returns real numbers when at least 5 responses and all splits >= 5', async () => {
    // 16 responses: promoters=6 (>=9), passives=5 (7-8), detractors=5 (<=6)
    // All three splits >= 5 → neither response-floor nor split-floor fires.
    // eNPS = round((6 - 5) / 16 * 100) = round(6.25) = 6
    surveyResponseFindMany.mockResolvedValue([
      // 6 promoters
      resp(10), resp(10), resp(9), resp(9), resp(9), resp(10),
      // 5 passives
      resp(8), resp(8), resp(7), resp(7), resp(8),
      // 5 detractors
      resp(5), resp(4), resp(3), resp(6), resp(2),
    ]);
    const r = await caller().getEnps({ period: 'quarter' });

    expect(r.suppressed).toBe(false);
    expect(r.totalResponses).toBe(16);
    expect(r.promoters).toBe(6);
    expect(r.detractors).toBe(5);
    expect(r.passives).toBe(5);
    expect(r.enps).toBe(6); // round((6 - 5) / 16 * 100) = round(6.25) = 6
  });

  it('passes through 0 responses unsuppressed (reveals no individual)', async () => {
    surveyResponseFindMany.mockResolvedValue([]);
    const r = await caller().getEnps({ period: 'quarter' });
    expect(r.suppressed).toBe(false);
    expect(r.totalResponses).toBe(0);
  });

  it('suppresses whole result when total>=5 but a per-split bucket is 1..4', async () => {
    // promoters=6 (scores 9-10), detractors=3 (scores 0-6), passives=1 (score 7-8)
    // total=10 → total-floor passes. But passives=1 < 5 → split-suppressed must fire.
    //
    // Without the fix: promoters=6, passives=1, detractors=3 are returned directly.
    // The oracle attack: totalResponses(10) − promoters(6) − detractors(3) = 1 recovers
    // the hidden passives bucket. After the fix: all four fields must be null.
    surveyResponseFindMany.mockResolvedValue([
      // 6 promoters (score >= 9)
      resp(10), resp(10), resp(9), resp(9), resp(9), resp(10),
      // 3 detractors (score <= 6)
      resp(5), resp(3), resp(6),
      // 1 passive (score 7-8)
      resp(8),
    ]);
    const r = await caller().getEnps({ period: 'quarter' });

    // The per-split suppression must trigger: passives=1 is below the min-5 floor.
    expect(r.suppressed).toBe(true);
    expect(r.enps).toBeNull();
    expect(r.promoters).toBeNull();
    expect(r.passives).toBeNull();
    expect(r.detractors).toBeNull();
    // totalResponses must also be nulled — it provides the differencing input.
    expect(r.totalResponses).toBeNull();
  });
});
