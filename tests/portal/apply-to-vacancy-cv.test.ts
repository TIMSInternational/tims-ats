import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('portal.applyToVacancy — CV processing', () => {
  it('processes the CV for a new application when cvFileKey is provided', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/org/x.pdf',
      cvFileName: 'resume.pdf',
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, 'cv-uploads/org/x.pdf', 'resume.pdf');
  });

  it('falls back to the key basename when cvFileName is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/org/x.pdf',
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, 'cv-uploads/org/x.pdf', 'x.pdf');
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
      cvFileKey: 'cv-uploads/org/x.pdf',
    });

    expect(dbMocks.application.create).not.toHaveBeenCalled();
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
