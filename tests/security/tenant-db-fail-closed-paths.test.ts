import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// F15a — the paths that used to reach `tenantDb` with NO tenant in scope, driven through the
// REAL tRPC middleware stack and the REAL tenantDb extension (only the Prisma client beneath it
// is faked). Before the fix every one of these ran unscoped on the BYPASSRLS login role; now
// tenantDb fails closed, and each legitimate caller is either scoped to its org or opted in by
// name via runUnscoped.

const h = vi.hoisted(() => {
  type Call = { model: string; operation: string; args: unknown; scoped: boolean };
  const calls: Call[] = [];
  const results = new Map<string, unknown>();
  let inTx = false;
  type AllOps = (p: {
    model: string;
    operation: string;
    args: unknown;
    query: (a: unknown) => Promise<unknown>;
  }) => Promise<unknown>;

  const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const run = async (model: string, operation: string, args: unknown) => {
    calls.push({ model, operation, args, scoped: inTx });
    const r = results.get(`${model}.${operation}`);
    return typeof r === 'function' ? (r as (a: unknown) => unknown)(args) : (r ?? null);
  };
  const modelProxy = (model: string) =>
    new Proxy({}, { get: (_t, op: string) => (args: unknown) => run(model, op, args) });

  const base: Record<string, unknown> = {
    $executeRaw: () => Promise.resolve(1),
    $transaction: async (x: unknown) => {
      if (!Array.isArray(x)) return (x as (tx: unknown) => unknown)(baseProxy);
      inTx = true;
      try {
        return await Promise.all(x as Array<Promise<unknown>>);
      } finally {
        inTx = false;
      }
    },
    $extends: (ext: { query: { $allOperations: AllOps } }) =>
      new Proxy(
        {},
        {
          get: (_t, modelKey: string) =>
            new Proxy(
              {},
              {
                // LAZY like a real PrismaPromise: calling the model method does NOTHING; the
                // extension ($allOperations — where the tenant context is read) runs only when
                // .then is called. An eager mock hid Codex's P1 (un-awaited queries returned
                // from sync runWithTenant callbacks execute after the scope exits).
                get: (_t2, op: string) => (args: unknown) => ({
                  then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                    ext.query
                      .$allOperations({
                        model: pascal(modelKey),
                        operation: op,
                        args,
                        query: (a: unknown) =>
                          ({
                            then: (r2: (v: unknown) => unknown, j2: (e: unknown) => unknown) =>
                              run(pascal(modelKey), op, a).then(r2, j2),
                          }) as unknown as Promise<unknown>,
                      })
                      .then(res, rej),
                }),
              },
            ),
        },
      ),
  };
  const baseProxy: Record<string, unknown> = new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : modelProxy(pascal(k))),
  });
  return { calls, results, baseProxy };
});

vi.mock('../../packages/db/src/client', () => ({ db: h.baseProxy }));

const ORG_ID = '11111111-1111-1111-1111-111111111111';

function ctxFor(user: Record<string, unknown> | null) {
  return { user, headers: new Headers(), supabaseAuth: null, externalAuth: null } as never;
}

beforeEach(() => {
  h.calls.length = 0;
  h.results.clear();
  vi.stubEnv('RLS_ENFORCED', 'true');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('tRPC + tenantDb — fail closed unless scoped or explicitly opted in', () => {
  it('a publicProcedure that touches tenantDb without a scope now throws (was: unscoped query)', async () => {
    const { router, publicProcedure, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { tenantDb } = await import('@tims/db');
    const r = router({ leak: publicProcedure.query(() => tenantDb.candidate.findMany({ select: { id: true } })) });
    await expect(createCallerFactory(r)(ctxFor(null)).leak()).rejects.toThrow(/no tenant in scope/);
    expect(h.calls).toHaveLength(0);
  });

  it('staff with an org: protectedProcedure queries run scoped (inside the RLS transaction)', async () => {
    const { router, protectedProcedure, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { tenantDb } = await import('@tims/db');
    const r = router({ list: protectedProcedure.query(() => tenantDb.candidate.findMany({ select: { id: true } })) });
    await createCallerFactory(r)(
      ctxFor({
        id: 'u1',
        organizationId: ORG_ID,
        roles: ['hr_admin'],
        isPlatformOwner: false,
        impersonatorId: null,
        email: 'a@b.c',
        isActive: true,
      }),
    ).list();
    expect(h.calls).toEqual([expect.objectContaining({ model: 'Candidate', operation: 'findMany', scoped: true })]);
  });

  it('org-less platform owner: enters the named, logged unscoped scope (behavior preserved)', async () => {
    const { logger } = await import('@tims/shared');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    const { router, protectedProcedure, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { tenantDb, getUnscopedReason } = await import('@tims/db');
    let reason: string | null = 'unset';
    const r = router({
      list: protectedProcedure.query(() => {
        reason = getUnscopedReason();
        return tenantDb.notification.findMany({ select: { id: true } });
      }),
    });
    await createCallerFactory(r)(
      ctxFor({
        id: 'owner',
        organizationId: null,
        roles: [],
        isPlatformOwner: true,
        impersonatorId: null,
        email: 'o@t.co',
        isActive: true,
      }),
    ).list();
    expect(reason).toBe('platform-owner-without-org');
    expect(h.calls).toEqual([expect.objectContaining({ model: 'Notification', scoped: false })]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ unscopedReason: 'platform-owner-without-org' }),
      expect.stringContaining('unscoped'),
    );
  });

  it('public offer.getBySigningToken runs in the named offer-signing-token scope', async () => {
    const { router, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
    h.results.set('Offer.findMany', [{ id: 'o1', status: 'sent', expiresAt: null }]);
    const res = await createCallerFactory(router({ offer: offerSigningRouter }))(ctxFor(null)).offer.getBySigningToken({
      token: 'tok',
    });
    expect(res).toMatchObject({ id: 'o1' });
    expect(h.calls).toEqual([expect.objectContaining({ model: 'Offer', operation: 'findMany', scoped: false })]);
  });

  it('public offer.acceptByToken / declineByToken reach tenantDb without throwing', async () => {
    const { router, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { offerSigningRouter } = await import('../../packages/api/src/routers/offer/signing');
    h.results.set('Offer.findMany', [{ id: 'o1', status: 'sent', settings: {}, expiresAt: null }]);
    h.results.set('Offer.findFirst', null);
    h.results.set('Offer.updateMany', { count: 1 });
    const c = createCallerFactory(router({ offer: offerSigningRouter }))(ctxFor(null));
    await expect(c.offer.acceptByToken({ token: 'tok', signatureName: 'QA Person' })).resolves.toEqual({
      success: true,
    });
    await expect(c.offer.declineByToken({ token: 'tok' })).resolves.toEqual({ success: true });
  });

  it('public CV processing (portal.applyToVacancy) runs its tenantDb writes scoped to the vacancy org', async () => {
    vi.doMock('../../packages/api/src/lib/s3', () => ({
      fetchCvObject: vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), sizeBytes: 1 }),
    }));
    vi.doMock('../../packages/api/src/lib/cv-extraction', () => ({
      extractCvText: vi.fn().mockResolvedValue('cv text'),
    }));
    let orgDuringParse: string | null = 'unset';
    vi.doMock('../../packages/api/src/services/candidate-ai.service', async () => {
      const { getTenantOrgId } = await import('@tims/db');
      return {
        candidateAiService: {
          parseCV: vi.fn(async () => {
            orgDuringParse = getTenantOrgId();
          }),
        },
      };
    });
    const { logger } = await import('@tims/shared');
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    h.results.set('CandidateDocument.create', { id: 'doc1' });
    const { portalApplicationService } = await import('../../packages/api/src/services/portal-application.service');

    await portalApplicationService.processCvUpload(ORG_ID, 'cand1', `cv-uploads/${ORG_ID}/a.pdf`, 'a.pdf');

    // processCvUpload swallows errors by design, so a fail-closed throw would be SILENT —
    // assert the write happened, scoped, and nothing was logged as a failure.
    expect(errorLog).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      // idempotency lookup (#314) — scoped like the write
      expect.objectContaining({ model: 'CandidateDocument', operation: 'findFirst', scoped: true }),
      expect.objectContaining({ model: 'CandidateDocument', operation: 'create', scoped: true }),
    ]);
    expect(orgDuringParse).toBe(ORG_ID);
    vi.doUnmock('../../packages/api/src/lib/s3');
    vi.doUnmock('../../packages/api/src/lib/cv-extraction');
    vi.doUnmock('../../packages/api/src/services/candidate-ai.service');
  });

  it('public aiInterview.start runs its budget reads scoped to the session org (was: unscoped)', async () => {
    vi.doMock('../../packages/api/src/lib/elevenlabs', () => ({ isElevenLabsConfigured: () => true }));
    vi.doMock('../../packages/api/src/integrations/elevenlabs', () => ({
      getSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'wss://x', conversationId: 'conv-1' }),
    }));
    vi.doMock('../../packages/api/src/services/ai-interview-access.service', async (importOriginal) => ({
      ...(await importOriginal<object>()),
      assertAiInterviewEnabled: vi.fn().mockResolvedValue({ enabled: true }),
    }));
    h.results.set('AiInterviewSession.findUnique', {
      id: 's1',
      organizationId: ORG_ID,
      status: 'pending',
      consentedAt: new Date(),
      elevenlabsAgentId: 'agent-1',
      guideQuestions: [],
      maxDurationSeconds: 600,
    });
    h.results.set('AiAgentUsageLog.aggregate', { _sum: { costUsd: 0 } });
    const { router, createCallerFactory } = await import('../../packages/api/src/trpc');
    const { aiInterviewRouter } = await import('../../packages/api/src/routers/ai-interview');

    const res = await createCallerFactory(router({ ai: aiInterviewRouter }))(ctxFor(null)).ai.start({
      candidateToken: '33333333-3333-3333-3333-333333333333',
    });

    expect(res).toMatchObject({ signedUrl: 'wss://x' });
    const tenantReads = h.calls.filter((c) => c.model === 'AiAgentOrgConfig' || c.model === 'AiAgentUsageLog');
    expect(tenantReads).toHaveLength(2);
    expect(tenantReads.every((c) => c.scoped)).toBe(true);
    vi.doUnmock('../../packages/api/src/lib/elevenlabs');
    vi.doUnmock('../../packages/api/src/integrations/elevenlabs');
    vi.doUnmock('../../packages/api/src/services/ai-interview-access.service');
  });

  it('candidate dashboard: getDisplayCandidate (sync runWithTenant callback) runs scoped, not after the scope', async () => {
    h.results.set('Candidate.findFirst', { firstName: 'Ana' });
    const { candidatePortalService } = await import('../../packages/api/src/services/candidate-portal.service');

    await expect(candidatePortalService.getDisplayCandidate(ORG_ID, 'ana@example.test')).resolves.toEqual({
      firstName: 'Ana',
    });
    expect(h.calls).toEqual([expect.objectContaining({ model: 'Candidate', operation: 'findFirst', scoped: true })]);
  });

  it('assessment submission: candidate + pre-check reads run scoped (reach NOT_FOUND, not a tenant error)', async () => {
    h.results.set('Organization.findUnique', { id: ORG_ID, name: 'Org', isActive: true });
    h.results.set('Candidate.findFirst', { id: 'cand-1' });
    h.results.set('AssessmentAssignment.findFirst', null);
    const { candidateAssessmentService } = await import('../../packages/api/src/services/candidate-assessment.service');

    await expect(
      candidateAssessmentService.submitAssessment('ana@example.test', 'org', '44444444-4444-4444-4444-444444444444', []),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const tenantReads = h.calls.filter((c) => c.model !== 'Organization');
    expect(tenantReads.map((c) => `${c.model}.${c.operation}`)).toEqual([
      'Candidate.findFirst',
      'AssessmentAssignment.findFirst',
    ]);
    expect(tenantReads.every((c) => c.scoped)).toBe(true);
  });
});
