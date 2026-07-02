/**
 * kpi-cache.test.ts  (Task 3 — S3)
 *
 * Behavioral assertions:
 *   (a) Two successive calls to a cached KPI procedure run the DB aggregation
 *       body exactly once — the second call is served from cache.
 *   (b) featureFlag.update calls cacheInvalidatePrefix with the org's flag prefix
 *       after writing.
 *
 * Pattern mirrors tests/access/ai-interview-router.test.ts:
 *   vi.mock('@tims/db') + permissionProcedure shim + createCallerFactory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock declarations — must be at module top level (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidatePrefix: vi.fn().mockResolvedValue(undefined),
  invalidatePermissionCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tims/db', () => ({
  db: {
    rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    featureFlag: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'flag-1', key: 'some_flag', enabled: true, payload: null, organizationId: 'org-uuid-1' }),
      upsert: vi.fn().mockResolvedValue({ id: 'flag-1', key: 'some_flag', enabled: true }),
      delete: vi.fn().mockResolvedValue({ id: 'c0000000-0000-0000-0000-000000000001', key: 'some_flag', organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organization: { findMany: vi.fn().mockResolvedValue([]) },
  },
  tenantDb: {
    okr: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _avg: { progress: null } }),
    },
    coachingSession: { count: vi.fn().mockResolvedValue(0) },
    commitment: { count: vi.fn().mockResolvedValue(0) },
    feedback: { count: vi.fn().mockResolvedValue(0) },
    recognition: { count: vi.fn().mockResolvedValue(0) },
    // learning KPIs
    course: { count: vi.fn().mockResolvedValue(0) },
    enrollment: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _avg: { progress: null } }),
    },
    certificate: { count: vi.fn().mockResolvedValue(0) },
    learningPath: { count: vi.fn().mockResolvedValue(0) },
    // teamIntel KPIs
    team: { count: vi.fn().mockResolvedValue(0) },
    userTeam: { count: vi.fn().mockResolvedValue(0) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    // vacancy KPIs
    vacancy: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    application: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    featureFlag: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'flag-1', key: 'some_flag', enabled: true, payload: null, organizationId: 'org-uuid-1' }),
    },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  Prisma: { JsonNull: null },
  SubscriptionStatus: { active: 'active', trialing: 'trialing' },
  InvoiceStatus: { pending: 'pending' },
  InvitationStatus: { pending: 'pending', sent: 'sent' },
}));

vi.mock('../../packages/api/src/access/build', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({
    allowed: true,
    scope: 'organization',
    roles: ['super_admin'],
  }),
}));

vi.mock('../../packages/api/src/access/anchors', () => ({
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));

vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({
    allowed: true,
    scope: 'organization',
    roles: ['super_admin'],
  }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  requireOrgScope: vi.fn(),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  assertSubjectInScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

// ---------------------------------------------------------------------------
// Imports happen AFTER vi.mock hoisting
// ---------------------------------------------------------------------------

import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../../packages/api/src/lib/cache';
import { tenantDb, db } from '@tims/db';

// ---------------------------------------------------------------------------
// Shared caller factory
// ---------------------------------------------------------------------------

const TEST_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_USER_ID = 'b1ffcd00-0d1c-4f09-cc7e-7cc0ce491b22';

function baseUser() {
  return {
    id: TEST_USER_ID,
    organizationId: TEST_ORG_ID,
    roles: ['super_admin'],
    isPlatformOwner: false,
    impersonatorId: null,
    email: 'admin@tims.co',
    isActive: true,
  };
}

function baseCtx() {
  return {
    user: baseUser(),
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  };
}

async function makePerformanceCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { performanceDashboardRouter } = await import(
    '../../packages/api/src/routers/performance/dashboard'
  );
  const testRouter = router({ performanceDashboard: performanceDashboardRouter });
  const factory = createCallerFactory(testRouter);
  return factory(baseCtx() as never);
}

async function makeLearningCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { learningRouter } = await import('../../packages/api/src/routers/learning');
  const testRouter = router({ learning: learningRouter });
  const factory = createCallerFactory(testRouter);
  return factory(baseCtx() as never);
}

async function makeTeamIntelCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { teamIntelRouter } = await import('../../packages/api/src/routers/teamIntel');
  const testRouter = router({ teamIntel: teamIntelRouter });
  const factory = createCallerFactory(testRouter);
  return factory(baseCtx() as never);
}

async function makeVacancyCaller(userId: string, scope: string) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyStatsRouter } = await import('../../packages/api/src/routers/vacancy/stats');
  const testRouter = router({ vacancy: vacancyStatsRouter });
  const factory = createCallerFactory(testRouter);
  return factory({
    ...baseCtx(),
    user: { ...baseUser(), id: userId },
    access: { allowed: true, scope, roles: ['team_leader'] },
  } as never);
}

async function makeFeatureFlagCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { featureFlagRouter } = await import('../../packages/api/src/routers/featureFlag');
  const testRouter = router({ featureFlag: featureFlagRouter });
  const factory = createCallerFactory(testRouter);
  return factory(baseCtx() as never);
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore sensible mocked defaults after clearAllMocks.
  vi.mocked(cacheGet).mockResolvedValue(null);
  vi.mocked(cacheSet).mockResolvedValue(undefined);
  vi.mocked(cacheInvalidatePrefix).mockResolvedValue(undefined);

  vi.mocked(tenantDb.okr.count).mockResolvedValue(0);
  vi.mocked(tenantDb.okr.aggregate).mockResolvedValue({ _avg: { progress: null } } as never);
  vi.mocked(tenantDb.coachingSession.count).mockResolvedValue(0);
  vi.mocked(tenantDb.commitment.count).mockResolvedValue(0);
  vi.mocked(tenantDb.feedback.count).mockResolvedValue(0);
  vi.mocked(tenantDb.recognition.count).mockResolvedValue(0);
  vi.mocked(tenantDb.course.count).mockResolvedValue(0);
  vi.mocked(tenantDb.enrollment.count).mockResolvedValue(0);
  vi.mocked(tenantDb.enrollment.aggregate).mockResolvedValue({ _avg: { progress: null } } as never);
  vi.mocked(tenantDb.certificate.count).mockResolvedValue(0);
  vi.mocked(tenantDb.learningPath.count).mockResolvedValue(0);
  vi.mocked(tenantDb.team.count).mockResolvedValue(0);
  vi.mocked(tenantDb.userTeam.count).mockResolvedValue(0);
  vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
  vi.mocked(tenantDb.featureFlag.findUnique).mockResolvedValue(null);
  vi.mocked(tenantDb.featureFlag.update).mockResolvedValue({
    id: 'flag-1',
    key: 'some_flag',
    enabled: true,
    payload: null,
    organizationId: 'org-uuid-1',
  } as never);

  // db (platform/privileged path) defaults
  vi.mocked(db.featureFlag.upsert).mockResolvedValue({ id: 'flag-1', key: 'some_flag', enabled: true } as never);
  vi.mocked(db.featureFlag.delete).mockResolvedValue({ id: 'c0000000-0000-0000-0000-000000000001', key: 'some_flag', organizationId: TEST_ORG_ID } as never);
  vi.mocked(db.featureFlag.deleteMany).mockResolvedValue({ count: 0 });
  vi.mocked(db.organization.findMany).mockResolvedValue([]);
  vi.mocked(db.auditLog.create).mockResolvedValue(undefined as never);
});

// ---------------------------------------------------------------------------
// Behavioral test (a): second call is served from cache (DB runs once)
// ---------------------------------------------------------------------------

describe('performanceDashboard.getDashboardKpis — cache-aside', () => {
  it('calls the DB body only once when invoked twice (second call uses cache hit)', async () => {
    // First call: cache miss → runs DB → writes cache.
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    const caller = await makePerformanceCaller();
    await caller.performanceDashboard.getDashboardKpis();

    expect(vi.mocked(cacheGet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cacheSet)).toHaveBeenCalledTimes(1);
    // The DB body ran (e.g. okr.count was called)
    const dbCallsAfterFirst = vi.mocked(tenantDb.okr.count).mock.calls.length;
    expect(dbCallsAfterFirst).toBeGreaterThan(0);

    // Second call: cache HIT → return cached value, skip DB body.
    const cachedValue = { activeOkrs: 5 };
    vi.mocked(cacheGet).mockResolvedValueOnce(cachedValue);

    const result2 = await caller.performanceDashboard.getDashboardKpis();
    // DB should NOT have been called again
    expect(vi.mocked(tenantDb.okr.count).mock.calls.length).toBe(dbCallsAfterFirst);
    // The cached value is returned as-is
    expect(result2).toEqual(cachedValue);
  });

  it('cacheSet is called with key tims:kpis:performance:<orgId> and TTL 45', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    const caller = await makePerformanceCaller();
    await caller.performanceDashboard.getDashboardKpis();

    expect(vi.mocked(cacheSet)).toHaveBeenCalledWith(
      `tims:kpis:performance:${TEST_ORG_ID}`,
      expect.anything(),
      45,
    );
  });
});

describe('learning.getDashboardKpis — cache-aside', () => {
  it('calls the DB body only once when invoked twice (second call uses cache hit)', async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    const caller = await makeLearningCaller();
    await caller.learning.getDashboardKpis();

    const dbCallsAfterFirst = vi.mocked(tenantDb.course.count).mock.calls.length;
    expect(dbCallsAfterFirst).toBeGreaterThan(0);
    expect(vi.mocked(cacheSet)).toHaveBeenCalledTimes(1);

    // Second call: cache HIT
    const cachedValue = { totalCourses: 10 };
    vi.mocked(cacheGet).mockResolvedValueOnce(cachedValue);

    const result2 = await caller.learning.getDashboardKpis();
    expect(vi.mocked(tenantDb.course.count).mock.calls.length).toBe(dbCallsAfterFirst);
    expect(result2).toEqual(cachedValue);
  });

  it('cacheSet is called with key tims:kpis:learning:<orgId> and TTL 45', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    const caller = await makeLearningCaller();
    await caller.learning.getDashboardKpis();

    expect(vi.mocked(cacheSet)).toHaveBeenCalledWith(
      `tims:kpis:learning:${TEST_ORG_ID}`,
      expect.anything(),
      45,
    );
  });
});

// ---------------------------------------------------------------------------
// teamIntel.getDashboardKpis — cache-aside
// ---------------------------------------------------------------------------

describe('teamIntel.getDashboardKpis — cache-aside', () => {
  it('calls the DB body only once when invoked twice (second call uses cache hit)', async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    const caller = await makeTeamIntelCaller();
    await caller.teamIntel.getDashboardKpis();

    const dbCallsAfterFirst = vi.mocked(tenantDb.team.count).mock.calls.length;
    expect(dbCallsAfterFirst).toBeGreaterThan(0);
    expect(vi.mocked(cacheSet)).toHaveBeenCalledTimes(1);

    // Second call: cache HIT → return cached value, skip DB body.
    const cachedValue = { totalTeams: 4, totalMembers: 20, teamsWithLeader: 3, teamsWithoutLeader: 1, avgTeamSize: 5, avgTenureYears: 1.5, diversityIndex: 0.8 };
    vi.mocked(cacheGet).mockResolvedValueOnce(cachedValue);

    const result2 = await caller.teamIntel.getDashboardKpis();
    expect(vi.mocked(tenantDb.team.count).mock.calls.length).toBe(dbCallsAfterFirst);
    expect(result2).toEqual(cachedValue);
  });

  it('cacheSet is called with key tims:kpis:teamintel:<orgId> and TTL 45', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    const caller = await makeTeamIntelCaller();
    await caller.teamIntel.getDashboardKpis();

    expect(vi.mocked(cacheSet)).toHaveBeenCalledWith(
      `tims:kpis:teamintel:${TEST_ORG_ID}`,
      expect.anything(),
      45,
    );
  });
});

// ---------------------------------------------------------------------------
// vacancy.getDashboardKpis — cache key encodes scope identity (userId) for sub-org
// ---------------------------------------------------------------------------

const USER_A = 'aaaa0000-0000-0000-0000-000000000001';
const USER_B = 'bbbb0000-0000-0000-0000-000000000002';

// buildAccessForUser is called by the permissionProcedure middleware keyed on ctx.user.
// We need it to return scope='team' for USER_A/USER_B and scope='organization' for others.
import { buildAccessForUser as _buildAccessForUser } from '../../packages/api/src/access';

describe('vacancy.getDashboardKpis — sub-org scope key includes userId', () => {
  beforeEach(() => {
    vi.mocked(tenantDb.vacancy.count).mockResolvedValue(0);
    vi.mocked(tenantDb.vacancy.findMany).mockResolvedValue([]);
    vi.mocked(tenantDb.application.count).mockResolvedValue(0);
    vi.mocked(tenantDb.application.findMany).mockResolvedValue([]);
  });

  it('two team-scope callers (different userIds) use DIFFERENT cache keys', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    // Override buildAccessForUser to return scope='team' for team-leader users
    vi.mocked(_buildAccessForUser).mockImplementation(async (user: { id?: string }) => ({
      allowed: true,
      scope: [USER_A, USER_B].includes(user?.id ?? '') ? 'team' : 'organization',
      roles: ['team_leader'],
    }));

    const callerA = await makeVacancyCaller(USER_A, 'team');
    await callerA.vacancy.getDashboardKpis();

    const callerB = await makeVacancyCaller(USER_B, 'team');
    await callerB.vacancy.getDashboardKpis();

    const keys = vi.mocked(cacheSet).mock.calls.map((c) => c[0] as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain(USER_A);
    expect(keys[1]).toContain(USER_B);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('two org-scope callers (different userIds) share the SAME cache key', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    // Both users get org scope
    vi.mocked(_buildAccessForUser).mockResolvedValue({
      allowed: true,
      scope: 'organization',
      roles: ['super_admin'],
    });

    const callerA = await makeVacancyCaller(USER_A, 'organization');
    await callerA.vacancy.getDashboardKpis();

    const callerB = await makeVacancyCaller(USER_B, 'organization');
    await callerB.vacancy.getDashboardKpis();

    const keys = vi.mocked(cacheSet).mock.calls.map((c) => c[0] as string);
    expect(keys).toHaveLength(2);
    // Both must be the same org-level key (no userId suffix)
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(`tims:kpis:vacancy:${TEST_ORG_ID}:organization`);
  });
});

// ---------------------------------------------------------------------------
// Behavioral test (b): featureFlag.update calls cacheInvalidatePrefix
// ---------------------------------------------------------------------------

describe('featureFlag.update — cache invalidation', () => {
  it('calls cacheInvalidatePrefix with the org flag prefix after writing', async () => {
    const caller = await makeFeatureFlagCaller();
    await caller.featureFlag.update({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      enabled: true,
    });

    expect(vi.mocked(cacheInvalidatePrefix)).toHaveBeenCalledWith(
      `tims:flagcheck:${TEST_ORG_ID}:`,
    );
  });
});

describe('featureFlag.check — cache-aside', () => {
  it('caches the result on a miss', async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    const caller = await makeFeatureFlagCaller();
    await caller.featureFlag.check({ key: 'my_flag' });

    expect(vi.mocked(cacheSet)).toHaveBeenCalledWith(
      `tims:flagcheck:${TEST_ORG_ID}:my_flag`,
      expect.objectContaining({ enabled: expect.any(Boolean) }),
      300,
    );
  });

  it('returns cached value without hitting DB on a hit', async () => {
    const hit = { enabled: true, payload: { beta: true } };
    vi.mocked(cacheGet).mockResolvedValueOnce(hit);
    const caller = await makeFeatureFlagCaller();
    const result = await caller.featureFlag.check({ key: 'my_flag' });

    expect(result).toEqual(hit);
    expect(vi.mocked(tenantDb.featureFlag.findUnique)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Whole-branch fix pass tests
// ---------------------------------------------------------------------------

// Helper: platform-owner caller for the system router
async function makeSystemCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { systemRouter } = await import('../../packages/api/src/routers/platform/system');
  const testRouter = router({ system: systemRouter });
  const factory = createCallerFactory(testRouter);
  return factory({
    ...baseCtx(),
    user: { ...baseUser(), isPlatformOwner: true },
  } as never);
}

// Finding 1a: platform.updateFeatureFlag invalidates the org's flag cache
describe('platform.system.updateFeatureFlag — cache invalidation (Finding 1)', () => {
  it('calls cacheInvalidatePrefix with the org flag prefix after upsert', async () => {
    vi.mocked(db.featureFlag.upsert).mockResolvedValue({
      id: 'flag-1', key: 'ai_enabled', enabled: true,
    } as never);

    const caller = await makeSystemCaller();
    await caller.system.updateFeatureFlag({
      organizationId: TEST_ORG_ID,
      key: 'ai_enabled',
      enabled: true,
    });

    expect(vi.mocked(cacheInvalidatePrefix)).toHaveBeenCalledWith(
      `tims:flagcheck:${TEST_ORG_ID}:`,
    );
  });
});

// Finding 1b: platform.deleteFeatureFlag invalidates the deleted flag's org cache
describe('platform.system.deleteFeatureFlag — cache invalidation (Finding 1)', () => {
  it('calls cacheInvalidatePrefix with the deleted flag org prefix', async () => {
    const FLAG_ID = 'c0000000-0000-0000-0000-000000000001';
    vi.mocked(db.featureFlag.delete).mockResolvedValue({
      id: FLAG_ID, key: 'ai_enabled', organizationId: TEST_ORG_ID,
    } as never);

    const caller = await makeSystemCaller();
    await caller.system.deleteFeatureFlag({ id: FLAG_ID });

    expect(vi.mocked(cacheInvalidatePrefix)).toHaveBeenCalledWith(
      `tims:flagcheck:${TEST_ORG_ID}:`,
    );
  });
});

// Finding 3: vacancy.getDashboardKpis cache HIT returns recentVacancies[].createdAt as Date
describe('vacancy.getDashboardKpis — Date revival on cache hit (Finding 3)', () => {
  it('returns recentVacancies[0].createdAt as a Date instance on a cache hit', async () => {
    const isoString = '2026-01-15T10:30:00.000Z';
    const cachedValue = {
      totalOpen: 3,
      totalDraft: 1,
      totalPendingApproval: 0,
      totalPublished: 2,
      totalClosed: 1,
      totalApplications: 10,
      recentVacancies: [
        {
          id: 'vac-1',
          title: 'Engineer',
          status: 'published',
          createdAt: isoString,          // Simulates JSON.parse — arrives as string
          _count: { applications: 5 },
        },
      ],
    };
    vi.mocked(cacheGet).mockResolvedValueOnce(cachedValue);

    const callerOrg = await makeVacancyCaller(TEST_USER_ID, 'organization');
    const result = await callerOrg.vacancy.getDashboardKpis();

    expect(result.recentVacancies[0].createdAt).toBeInstanceOf(Date);
    expect((result.recentVacancies[0].createdAt as Date).toISOString()).toBe(isoString);
  });
});
