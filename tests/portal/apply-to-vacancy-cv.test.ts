import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const APPLICATION_ID = '55555555-5555-5555-5555-555555555555';

const dbMocks = {
  vacancy: { findFirstOrThrow: vi.fn() },
  candidate: { upsert: vi.fn() },
  application: { findFirst: vi.fn(), create: vi.fn() },
  pipelineStage: { findFirstOrThrow: vi.fn() },
};

vi.mock('@tims/db', () => ({ db: dbMocks }));

const processCvUploadMock = vi.fn();
vi.mock('../../packages/api/src/services/portal-application.service', () => ({
  portalApplicationService: { processCvUpload: (...a: unknown[]) => processCvUploadMock(...a) },
}));

const createPresignedPostMock = vi.fn();
vi.mock('../../packages/api/src/lib/s3', () => ({
  createCvUploadPresignedPost: (...a: unknown[]) => createPresignedPostMock(...a),
}));

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const testRouter = router({ portal: portalRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: null,
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    portal: {
      applyToVacancy(input: Record<string, unknown>): Promise<{ applicationId: string; candidateId: string }>;
      getCvUploadUrl(input: {
        vacancyId: string;
        fileName: string;
        contentType: string;
      }): Promise<{ url: string; fields: Record<string, string>; key: string }>;
    };
  };
}

const baseApplyInput = {
  vacancyId: VACANCY_ID,
  firstName: 'Ana',
  lastName: 'Gomez',
  email: 'ana@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.vacancy.findFirstOrThrow.mockResolvedValue({
    id: VACANCY_ID,
    organizationId: ORG_ID,
    stages: [{ id: STAGE_ID, isDefault: true }],
  });
  dbMocks.candidate.upsert.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.application.findFirst.mockResolvedValue(null);
  dbMocks.application.create.mockResolvedValue({ id: APPLICATION_ID });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('portal.applyToVacancy — CAPTCHA verification', () => {
  it('rejects a missing token before writing candidate data when a secret is configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow('Verificacion de seguridad fallida');
    expect(dbMocks.candidate.upsert).not.toHaveBeenCalled();
  });

  it('accepts a successfully verified token', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, captchaToken: 'test-token' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(dbMocks.application.create).toHaveBeenCalledOnce();
  });

  it('rejects a malformed or failed verification response', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-secret');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: 'true' }), { status: 200 }));
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, captchaToken: 'test-token' })).rejects.toThrow();
    expect(dbMocks.candidate.upsert).not.toHaveBeenCalled();
  });
});

describe('portal.applyToVacancy — CV processing', () => {
  it('does not overwrite an existing candidate profile based on an unauthenticated email claim', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({ ...baseApplyInput, firstName: 'Impersonator' });

    expect(dbMocks.candidate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_email: { organizationId: ORG_ID, email: baseApplyInput.email } },
        update: {},
      }),
    );
  });

  it('processes the CV for a new application when cvFileKey is provided', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
      cvFileName: 'resume.pdf',
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, `cv-uploads/${ORG_ID}/x.pdf`, 'resume.pdf');
  });

  it('falls back to the key basename when cvFileName is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, `cv-uploads/${ORG_ID}/x.pdf`, 'x.pdf');
  });

  it('never processes a CV when cvFileKey is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy(baseApplyInput);

    expect(processCvUploadMock).not.toHaveBeenCalled();
  });

  it('never re-processes a CV on an idempotent duplicate submit', async () => {
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
    });

    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });

  it('silently ignores a cvFileKey that does not belong to this org (IDOR guard)', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/some-other-org/x.pdf',
      cvFileName: 'resume.pdf',
    });

    expect(dbMocks.application.create).toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });
});

describe('portal.getCvUploadUrl', () => {
  it('resolves the organizationId from the published vacancy and returns the presigned post', async () => {
    createPresignedPostMock.mockResolvedValue({
      url: 'https://s3.example.com',
      fields: { key: 'cv-uploads/org/x.pdf' },
      key: 'cv-uploads/org/x.pdf',
    });
    const caller = await makeCaller();

    const result = await caller.portal.getCvUploadUrl({
      vacancyId: VACANCY_ID,
      fileName: 'resume.pdf',
      contentType: 'application/pdf',
    });

    expect(dbMocks.vacancy.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: VACANCY_ID, status: 'published', deletedAt: null },
      select: { organizationId: true },
    });
    expect(createPresignedPostMock).toHaveBeenCalledWith(ORG_ID, 'application/pdf');
    expect(result.key).toBe('cv-uploads/org/x.pdf');
  });

  it('rejects a content type outside the allowed whitelist', async () => {
    const caller = await makeCaller();

    await expect(
      caller.portal.getCvUploadUrl({
        vacancyId: VACANCY_ID,
        fileName: 'resume.png',
        contentType: 'image/png',
      }),
    ).rejects.toThrow();
    expect(createPresignedPostMock).not.toHaveBeenCalled();
  });
});
