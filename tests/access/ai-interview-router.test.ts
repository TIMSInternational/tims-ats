/**
 * ai-interview-router.test.ts
 *
 * Tests for the aiInterview tRPC router (Task 4).
 *
 * Strategy: static source-text checks (same pattern as scope-wiring-*.test.ts)
 * plus lightweight unit tests that mock the service/repository/db so we can
 * exercise gate ordering without hitting the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { blockAt } from '../helpers/source-blocks';

// ---------------------------------------------------------------------------
// Static source-level guards (pattern from scope-wiring-offer.test.ts)
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '..', '..');
const readRouter = () => readFileSync(join(ROOT, 'packages/api/src/routers/ai-interview.ts'), 'utf8');

describe('aiInterview router — static source guards', () => {
  it('create: uses permissionProcedure("interview", "create")', () => {
    expect(readRouter()).toMatch(/permissionProcedure\(['"]interview['"],\s*['"]create['"]\)/);
  });

  it('getResult: uses permissionProcedure("interview", "read")', () => {
    expect(readRouter()).toMatch(/permissionProcedure\(['"]interview['"],\s*['"]read['"]\)/);
  });

  it('recordConsent: uses publicProcedure (no login required)', () => {
    const src = readRouter();
    const consentBlock = blockAt(src, 'recordConsent:');
    expect(consentBlock).toMatch(/publicProcedure/);
  });

  it('start: uses publicProcedure (token-authorised, no login)', () => {
    const src = readRouter();
    const startBlock = blockAt(src, 'start:');
    expect(startBlock).toMatch(/publicProcedure/);
  });

  it('start: contains a comment explaining ElevenLabs dynamic_variables are client-side', () => {
    const src = readRouter();
    // Must have either a comment or in-code note about client-side / client forwarding
    expect(src).toMatch(/dynamic.?variables.*client/i);
  });

  it('start output never contains the literal string ELEVENLABS_API_KEY', () => {
    // The signed URL response must not leak the key name or value.
    // The implementation should never put ELEVENLABS_API_KEY in a return statement.
    const src = readRouter();
    // Check no return statement in start body echoes the env var name
    const startIdx = src.indexOf('start:');
    const getResultIdx = src.indexOf('getResult:');
    const startBlock = src.slice(startIdx, getResultIdx > startIdx ? getResultIdx : undefined);
    // The key name itself may appear in process.env access but MUST NOT appear in return value
    // (we verify the implementation does not put it in a return literal)
    const returnMatches = startBlock.match(/return\s*\{[^}]*ELEVENLABS_API_KEY[^}]*\}/s);
    expect(returnMatches).toBeNull();
  });

  it('recordConsent: calls db.aiInterviewSession.update with consentedAt', () => {
    expect(readRouter()).toMatch(/consentedAt/);
  });

  it('recordConsent: upserts DataConsent with consentType "ai_interview"', () => {
    expect(readRouter()).toMatch(/ai_interview/);
  });

  it('start: checks ElevenLabs configuration before session lookup', () => {
    const src = readRouter();
    const startIdx = src.indexOf('start:');
    const startBlock = src.slice(startIdx, startIdx + 800);
    // The configured check must appear before findSessionByCandidateToken
    const configCheckIdx = startBlock.search(/ELEVENLABS_API_KEY|isElevenLabsConfigured/);
    const sessionLookupIdx = startBlock.indexOf('findSessionByCandidateToken');
    expect(configCheckIdx).toBeGreaterThanOrEqual(0);
    expect(sessionLookupIdx).toBeGreaterThanOrEqual(0);
    expect(configCheckIdx).toBeLessThan(sessionLookupIdx);
  });

  // #46 regression guard. The router used to hand-roll its own config check testing only
  // ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID, while the correct 3-var helper in lib/elevenlabs
  // shipped dead (imported by tests only). The missing var is ELEVENLABS_WEBHOOK_SECRET, and it fails
  // LATE: `start` admitted the interview, the candidate completed it, and verifyWebhookSignature then
  // returned false, silently dropping the result — no analysis, no billing, no error.
  //
  // The test above this one does NOT catch that: its regex is /ELEVENLABS_API_KEY|isElevenLabsConfigured/,
  // which matches the broken 2-var form just as happily as the fixed one. Hence a separate assertion.
  it('start: uses the shared 3-var config gate and does not read ElevenLabs env vars directly', () => {
    const src = readRouter();

    // It must import the shared helper — the helper is the only place all three vars are checked.
    expect(src).toMatch(/import\s*\{[^}]*isElevenLabsConfigured[^}]*\}\s*from\s*['"]\.\.\/lib\/elevenlabs['"]/);

    // And it must not re-declare a local copy, which is how the 2-var version got there.
    expect(src).not.toMatch(/function\s+isElevenLabsConfigured\s*\(/);

    // Scanned over the WHOLE file, deliberately: bounding this to the `start` block would let a
    // partial env check reappear anywhere else in the router and still pass.
    //
    // ELEVENLABS_API_KEY specifically, not `ELEVENLABS_` broadly. The key is the var the deleted
    // 2-var gate keyed on and it has NO legitimate use in this router — the secret belongs to
    // integrations/elevenlabs, and the test above already asserts it never reaches a response body.
    // ELEVENLABS_AGENT_ID is deliberately NOT forbidden: `:276` uses it as a real per-session
    // fallback (`session.elevenlabsAgentId ?? process.env.ELEVENLABS_AGENT_ID`). A blanket
    // /process\.env\.ELEVENLABS_/ ban was tried first and failed on that correct line — the
    // assertion was wrong, not the code.
    expect(src).not.toMatch(/process\.env\.ELEVENLABS_API_KEY/);
  });

  it('start: gates on consentedAt before calling getSignedUrl', () => {
    const src = readRouter();
    const startIdx = src.indexOf('start:');
    const getResultIdx = src.indexOf('getResult:');
    const startBlock = src.slice(startIdx, getResultIdx > startIdx ? getResultIdx : undefined);
    const consentCheckIdx = startBlock.search(/consentedAt/);
    const signedUrlIdx = startBlock.indexOf('getSignedUrl');
    expect(consentCheckIdx).toBeGreaterThanOrEqual(0);
    expect(signedUrlIdx).toBeGreaterThanOrEqual(0);
    expect(consentCheckIdx).toBeLessThan(signedUrlIdx);
  });

  it('start: checks voice budget before calling getSignedUrl', () => {
    const src = readRouter();
    const startIdx = src.indexOf('start:');
    const getResultIdx = src.indexOf('getResult:');
    const startBlock = src.slice(startIdx, getResultIdx > startIdx ? getResultIdx : undefined);
    const budgetCheckIdx = startBlock.search(/monthlyBudget|Presupuesto/);
    const signedUrlIdx = startBlock.indexOf('getSignedUrl');
    expect(budgetCheckIdx).toBeGreaterThanOrEqual(0);
    expect(signedUrlIdx).toBeGreaterThanOrEqual(0);
    expect(budgetCheckIdx).toBeLessThan(signedUrlIdx);
  });

  it('no scope-fragment spreads (design invariant — AND compose only)', () => {
    expect(readRouter()).not.toMatch(/\.\.\.(await\s+)?scopeWhere/);
  });

  it('candidate-path writes (recordConsent + start) use candidateDb (systemDb), not tenantDb', () => {
    const src = readRouter();
    // Both candidate-path writes must reference candidateDb.
    // The recordConsent update, dataConsent upsert, and start session update must all use candidateDb.
    expect(src).toMatch(/candidateDb\.aiInterviewSession\.update/);
    expect(src).toMatch(/candidateDb\.dataConsent\.upsert/);
    // Confirm that no db (tenantDb alias) call appears in the candidate write section.
    // Extract the recordConsent block to the start of getResult.
    const consentStart = src.indexOf('recordConsent:');
    const getResultStart = src.indexOf('getResult:');
    const candidateBlock = src.slice(consentStart, getResultStart);
    // tenantDb alias `db.` must NOT appear in candidate writes block
    expect(candidateBlock).not.toMatch(/\bdb\.aiInterviewSession\.update/);
    expect(candidateBlock).not.toMatch(/\bdb\.dataConsent\.upsert/);
  });

  it('findSessionByCandidateToken repository method uses systemDb (not tenantDb)', () => {
    const repoSrc = readFileSync(join(ROOT, 'packages/api/src/repositories/ai-interview.repository.ts'), 'utf8');
    const methodStart = repoSrc.indexOf('findSessionByCandidateToken');
    const methodEnd = repoSrc.indexOf('},', methodStart);
    const methodBody = repoSrc.slice(methodStart, methodEnd);
    expect(methodBody).toMatch(/systemDb\.aiInterviewSession\.findUnique/);
    // Must NOT use the tenantDb alias (db) for this lookup
    expect(methodBody).not.toMatch(/\bdb\.aiInterviewSession\.findUnique/);
  });
});

// ---------------------------------------------------------------------------
// Behavioural unit tests — mock everything external
// ---------------------------------------------------------------------------

// Simulate ElevenLabs being configured so Gate 1 passes and we can test inner gates.
// These are set before module import (hoisted mocks run before vi.mock, but process.env
// modifications are fine here since they affect runtime checks, not import-time code).
process.env.ELEVENLABS_API_KEY = 'test-api-key';
process.env.ELEVENLABS_AGENT_ID = 'test-agent-id';

vi.mock('../../packages/api/src/services/ai-interview.service', () => ({
  aiInterviewService: {
    createAiInterviewSession: vi.fn(),
    getAiInterviewResult: vi.fn(),
  },
}));

vi.mock('../../packages/api/src/services/ai-interview-access.service', () => ({
  assertAiInterviewEnabled: vi.fn().mockResolvedValue({ enabled: true }),
  AI_INTERVIEW_DEFAULT_MAX_MINUTES: 15,
}));

vi.mock('../../packages/api/src/repositories/ai-interview.repository', () => ({
  aiInterviewRepository: {
    findSessionByCandidateToken: vi.fn(),
  },
}));

vi.mock('../../packages/api/src/integrations/elevenlabs', () => ({
  getSignedUrl: vi.fn(),
}));

// The config gate lives in lib/elevenlabs, NOT in integrations/elevenlabs. This mock used to sit on
// the integrations module with the comment "if isElevenLabsConfigured is exported by the real module
// it gets mocked here" — it never was exported there, so the mock was inert and the router's own
// 2-var copy is what actually ran. #46 replaced that copy with the shared 3-var helper, which made
// the misplacement visible: 7 tests began failing because the REAL gate ran and correctly returned
// false with no env vars set.
vi.mock('../../packages/api/src/lib/elevenlabs', () => ({
  isElevenLabsConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  // systemDb (db) — used by the candidate token path (recordConsent + start writes)
  // and by the webhook path. No org RLS GUC is set on these paths.
  db: {
    rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    aiInterviewSession: {
      update: vi.fn().mockResolvedValue({}),
    },
    dataConsent: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
  // tenantDb — used only by staff-path queries (budget check reads) that run under
  // an authenticated staff request context with the org RLS GUC set.
  tenantDb: {
    aiAgentOrgConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aiAgentUsageLog: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
    },
  },
  runWithTenant: (_o: string, f: () => unknown) => f(),
  AiInterviewStatus: {
    pending: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
  },
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
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

// ---------------------------------------------------------------------------
// Imports happen AFTER vi.mock hoisting
// ---------------------------------------------------------------------------

import { aiInterviewRepository } from '../../packages/api/src/repositories/ai-interview.repository';
import { getSignedUrl } from '../../packages/api/src/integrations/elevenlabs';
import { assertAiInterviewEnabled } from '../../packages/api/src/services/ai-interview-access.service';
// candidateDb = systemDb (db): candidate token-path and webhook writes run without an org RLS GUC.
// tenantDb: staff-path budget reads run under an authenticated tenant context.
import { db as candidateDb, tenantDb } from '@tims/db';

// Helper: build a tRPC caller that bypasses HTTP transport and runs procedures directly.
// Pattern mirrors how existing tests invoke routers (createCallerFactory approach).
async function makeCaller(overrideCtx?: Record<string, unknown>) {
  const { createCallerFactory } = await import('../../packages/api/src/trpc');
  const { aiInterviewRouter } = await import('../../packages/api/src/routers/ai-interview');

  // Re-import router to get a fresh instance after mocks are wired.
  const { router } = await import('../../packages/api/src/trpc');
  const testRouter = router({ aiInterview: aiInterviewRouter });
  const callerFactory = createCallerFactory(testRouter);

  const baseCtx = {
    user: {
      id: 'user-uuid-1',
      organizationId: 'org-uuid-1',
      roles: ['super_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'admin@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    ...overrideCtx,
  };

  return callerFactory(baseCtx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish sensible defaults after clearAllMocks.
  vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue(null);
  vi.mocked(getSignedUrl).mockResolvedValue({ signedUrl: 'wss://example.com/signed', conversationId: 'conv-1' });
  // assertAiInterviewEnabled is cleared by clearAllMocks — restore the pass-through default.
  vi.mocked(assertAiInterviewEnabled).mockResolvedValue({ enabled: true } as never);
});

// ---------------------------------------------------------------------------
// recordConsent — token resolution and write guards
// ---------------------------------------------------------------------------

describe('aiInterview.recordConsent', () => {
  it('throws NOT_FOUND when candidateToken resolves to no session', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue(null);

    const caller = await makeCaller({ user: undefined });
    await expect(
      caller.aiInterview.recordConsent({ candidateToken: 'bad-token', textVersion: 'v1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws BAD_REQUEST when session is not pending (already started)', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'in_progress' as never,
      consentedAt: null,
      elevenlabsAgentId: null,
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    const caller = await makeCaller({ user: undefined });
    await expect(
      caller.aiInterview.recordConsent({ candidateToken: 'some-token', textVersion: 'v1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('throws BAD_REQUEST when session status is completed', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'completed' as never,
      consentedAt: new Date(),
      elevenlabsAgentId: null,
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    const caller = await makeCaller({ user: undefined });
    await expect(
      caller.aiInterview.recordConsent({ candidateToken: 'some-token', textVersion: 'v1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('throws BAD_REQUEST when textVersion is an empty string', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: null,
      elevenlabsAgentId: null,
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    const caller = await makeCaller({ user: undefined });
    await expect(
      caller.aiInterview.recordConsent({ candidateToken: 'some-token', textVersion: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('writes consentedAt and upserts DataConsent for a valid pending session', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: null,
      elevenlabsAgentId: null,
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    // Mock the candidateDb (systemDb) calls that recordConsent makes.
    // These use candidateDb — the public candidate path has no org RLS GUC.
    const mockUpdate = vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>);
    mockUpdate.mockResolvedValue({});
    const mockUpsert = vi.mocked(candidateDb.dataConsent.upsert as unknown as (a: unknown) => Promise<unknown>);
    mockUpsert.mockResolvedValue({});

    const caller = await makeCaller({ user: undefined });
    const result = await caller.aiInterview.recordConsent({
      candidateToken: 'valid-token',
      textVersion: 'v1',
    });

    expect(result).toEqual({ success: true });
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// start — fail-closed gate ordering
// ---------------------------------------------------------------------------

describe('aiInterview.start', () => {
  it('throws FORBIDDEN when session.consentedAt is null', async () => {
    // ElevenLabs configured; session found but no consent
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: null, // <-- no consent
      elevenlabsAgentId: 'agent-1',
      guideQuestions: { questions: [] },
      maxDurationSeconds: null,
    });

    const caller = await makeCaller({ user: undefined });
    await expect(caller.aiInterview.start({ candidateToken: 'valid-token' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('meter-and-bill: proceeds (never throws) when voice budget is exhausted', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: new Date(), // consent OK
      elevenlabsAgentId: 'agent-1',
      guideQuestions: { questions: [] },
      maxDurationSeconds: null,
    });

    // Budget config exists with limit — uses tenantDb (staff-path budget reads)
    vi.mocked(tenantDb.aiAgentOrgConfig.findFirst as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      monthlyBudget: 50,
    });
    // Current month spend is over budget
    vi.mocked(tenantDb.aiAgentUsageLog.aggregate as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      _sum: { costUsd: 55 },
    });

    vi.mocked(getSignedUrl).mockResolvedValue({
      signedUrl: 'wss://api.elevenlabs.io/signed-over-budget',
      conversationId: 'conv-over-budget',
    });
    vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      {},
    );

    // Per the owner decision, entitlement enforcement is meter-and-bill and NEVER
    // hard-blocks — an over-budget org must still get a signed URL, not FORBIDDEN.
    const caller = await makeCaller({ user: undefined });
    const result = await caller.aiInterview.start({ candidateToken: 'valid-token' });
    expect(result).toHaveProperty('signedUrl');
  });

  it('returns signedUrl and dynamicVariables (never includes ELEVENLABS_API_KEY)', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: new Date(),
      elevenlabsAgentId: 'agent-xyz',
      guideQuestions: { questions: [{ text: 'Tell me about yourself' }] },
      maxDurationSeconds: null,
    });

    // No budget config → default $25 cap applies; spend is 0 so gate passes
    // Budget reads use tenantDb (staff context path inside start procedure).
    vi.mocked(tenantDb.aiAgentOrgConfig.findFirst as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      null,
    );
    vi.mocked(tenantDb.aiAgentUsageLog.aggregate as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      _sum: { costUsd: 0 },
    });

    vi.mocked(getSignedUrl).mockResolvedValue({
      signedUrl: 'wss://api.elevenlabs.io/signed-url-xyz',
      conversationId: 'conv-abc',
    });

    // Mock session update — uses candidateDb (systemDb) on the candidate path.
    vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      {},
    );

    const caller = await makeCaller({ user: undefined });
    const result = await caller.aiInterview.start({ candidateToken: 'valid-token' });

    expect(result).toHaveProperty('signedUrl');
    expect(result).toHaveProperty('dynamicVariables');
    // The API key must never appear in the response
    expect(JSON.stringify(result)).not.toContain('ELEVENLABS_API_KEY');
    expect(JSON.stringify(result)).not.toContain(process.env.ELEVENLABS_API_KEY ?? '__no_key__');
    // Gate invocation guard: assertAiInterviewEnabled MUST have been called with the
    // session's organizationId ('org-uuid-1'). If the gate call is deleted from the
    // start procedure this assertion will fail even if all other assertions pass.
    expect(vi.mocked(assertAiInterviewEnabled)).toHaveBeenCalledWith('org-uuid-1');
  });

  it('throws NOT_FOUND when token resolves to no session', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue(null);

    const caller = await makeCaller({ user: undefined });
    await expect(caller.aiInterview.start({ candidateToken: 'nonexistent-token' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('meter-and-bill: proceeds when NO config row exists and spend >= $25 (default cap)', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-1',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: new Date(),
      elevenlabsAgentId: 'agent-1',
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    // No config row → default cap of $25 applies — budget reads use tenantDb.
    vi.mocked(tenantDb.aiAgentOrgConfig.findFirst as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      null,
    );
    // Spend exactly at the default cap — must NOT block (meter-and-bill only).
    vi.mocked(tenantDb.aiAgentUsageLog.aggregate as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      _sum: { costUsd: 25 },
    });

    vi.mocked(getSignedUrl).mockResolvedValue({
      signedUrl: 'wss://api.elevenlabs.io/signed-default-cap',
      conversationId: 'conv-default-cap',
    });
    vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      {},
    );

    const caller = await makeCaller({ user: undefined });
    const result = await caller.aiInterview.start({ candidateToken: 'valid-token' });
    expect(result).toHaveProperty('signedUrl');
  });

  it('allows start when NO config row exists and spend < $25 (under default cap)', async () => {
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-2',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: new Date(),
      elevenlabsAgentId: 'agent-1',
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    // No config row → default cap of $25 applies — budget reads use tenantDb.
    vi.mocked(tenantDb.aiAgentOrgConfig.findFirst as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      null,
    );
    // Spend well under the default cap
    vi.mocked(tenantDb.aiAgentUsageLog.aggregate as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      _sum: { costUsd: 10 },
    });

    vi.mocked(getSignedUrl).mockResolvedValue({
      signedUrl: 'wss://api.elevenlabs.io/signed',
      conversationId: 'conv-def',
    });
    // Session update uses candidateDb (systemDb) on the candidate path.
    vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      {},
    );

    const caller = await makeCaller({ user: undefined });
    const result = await caller.aiInterview.start({ candidateToken: 'valid-token' });
    expect(result).toHaveProperty('signedUrl');
  });

  it('persists elevenlabsConversationId as null (not empty string) when getSignedUrl returns no conversation id', async () => {
    // Regression guard: a second session with no conversation_id must not trigger
    // a P2002 unique-constraint violation. The @unique String? column exempts NULL
    // from the uniqueness check; '' would cause a duplicate-key error.
    vi.mocked(aiInterviewRepository.findSessionByCandidateToken).mockResolvedValue({
      id: 'session-no-conv',
      organizationId: 'org-uuid-1',
      candidateId: 'cand-1',
      status: 'pending' as never,
      consentedAt: new Date(),
      elevenlabsAgentId: 'agent-1',
      guideQuestions: null,
      maxDurationSeconds: null,
    });

    vi.mocked(tenantDb.aiAgentOrgConfig.findFirst as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue(
      null,
    );
    vi.mocked(tenantDb.aiAgentUsageLog.aggregate as unknown as (a: unknown) => Promise<unknown>).mockResolvedValue({
      _sum: { costUsd: 0 },
    });

    // ElevenLabs omits conversation_id → getSignedUrl resolves with null.
    vi.mocked(getSignedUrl).mockResolvedValue({
      signedUrl: 'wss://api.elevenlabs.io/signed-no-conv',
      conversationId: null,
    });

    const mockUpdate = vi.mocked(candidateDb.aiInterviewSession.update as unknown as (a: unknown) => Promise<unknown>);
    mockUpdate.mockResolvedValue({});

    const caller = await makeCaller({ user: undefined });
    await caller.aiInterview.start({ candidateToken: 'valid-token' });

    // The update call must persist null, never an empty string.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ elevenlabsConversationId: null }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// create — auth gate (permissionProcedure)
// ---------------------------------------------------------------------------

describe('aiInterview.create', () => {
  it('throws UNAUTHORIZED when no user in context', async () => {
    const caller = await makeCaller({ user: null });
    await expect(
      caller.aiInterview.create({ interviewId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

// ---------------------------------------------------------------------------
// getResult — auth gate (permissionProcedure)
// ---------------------------------------------------------------------------

describe('aiInterview.getResult', () => {
  it('throws UNAUTHORIZED when no user in context', async () => {
    const caller = await makeCaller({ user: null });
    await expect(
      caller.aiInterview.getResult({ sessionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
