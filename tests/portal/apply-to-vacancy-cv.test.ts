import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { APPLICATION_CONSENT_TEXT_VERSION, APPLICATION_CONSENT_TYPE } from '../../packages/shared/src/constants/application-consent';

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const APPLICATION_ID = '55555555-5555-5555-5555-555555555555';

const dbMocks = {
  vacancy: { findFirstOrThrow: vi.fn() },
  candidate: { upsert: vi.fn() },
  dataConsent: { upsert: vi.fn() },
  application: { findFirst: vi.fn(), create: vi.fn() },
  pipelineStage: { findFirstOrThrow: vi.fn() },
  // Interactive transaction: the callback receives the same mocked client, so every
  // write made through `tx` is observable on dbMocks.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMocks)),
};

vi.mock('@tims/db', () => ({ db: dbMocks }));

// The public apply endpoint sits in the per-IP `ai` rate-limit tier; this file makes more
// calls than that tier allows in one window, which is not what these tests are about.
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('ai'),
}));

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
  consentAccepted: true,
  consentTextVersion: APPLICATION_CONSENT_TEXT_VERSION,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.vacancy.findFirstOrThrow.mockResolvedValue({
    id: VACANCY_ID,
    organizationId: ORG_ID,
    stages: [{ id: STAGE_ID, isDefault: true }],
  });
  dbMocks.candidate.upsert.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.dataConsent.upsert.mockResolvedValue({ id: 'consent-1' });
  dbMocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMocks));
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

describe('portal.applyToVacancy — explicit data-processing consent (F14)', () => {
  it('rejects a submission without consent before writing any candidate data', async () => {
    const caller = await makeCaller();
    const { consentAccepted: _omit, ...withoutConsent } = baseApplyInput;

    await expect(caller.portal.applyToVacancy(withoutConsent)).rejects.toThrow();
    expect(dbMocks.vacancy.findFirstOrThrow).not.toHaveBeenCalled();
    expect(dbMocks.candidate.upsert).not.toHaveBeenCalled();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });

  it('rejects consentAccepted: false', async () => {
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, consentAccepted: false })).rejects.toThrow(
      'Debes autorizar el tratamiento',
    );
    expect(dbMocks.candidate.upsert).not.toHaveBeenCalled();
  });

  it('rejects a superseded or missing consent text version', async () => {
    const caller = await makeCaller();
    const { consentTextVersion: _omit, ...withoutVersion } = baseApplyInput;

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, consentTextVersion: 'old' })).rejects.toThrow();
    await expect(caller.portal.applyToVacancy(withoutVersion)).rejects.toThrow();
    expect(dbMocks.candidate.upsert).not.toHaveBeenCalled();
  });

  it('records the consent (org, candidate, purpose, text version, timestamp) inside the application transaction', async () => {
    const order: string[] = [];
    dbMocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push('tx:start');
      const r = await fn(dbMocks);
      order.push('tx:end');
      return r;
    });
    dbMocks.dataConsent.upsert.mockImplementation(async () => {
      order.push('consent');
      return { id: 'consent-1' };
    });
    dbMocks.application.create.mockImplementation(async () => {
      order.push('application');
      return { id: APPLICATION_ID };
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(order).toEqual(['tx:start', 'consent', 'application', 'tx:end']);
    const arg = dbMocks.dataConsent.upsert.mock.calls[0]![0] as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.where).toEqual({
      subjectUserId_consentType: { subjectUserId: CANDIDATE_ID, consentType: APPLICATION_CONSENT_TYPE },
    });
    expect(arg.create).toMatchObject({
      organizationId: ORG_ID,
      subjectUserId: CANDIDATE_ID,
      consentType: APPLICATION_CONSENT_TYPE,
      textVersion: APPLICATION_CONSENT_TEXT_VERSION,
    });
    expect(arg.create.agreedAt).toBeInstanceOf(Date);
    // An unauthenticated email claim must never un-withdraw someone's consent.
    expect(arg.update).not.toHaveProperty('withdrawnAt');
  });

  it('does not create the application when recording consent fails', async () => {
    dbMocks.dataConsent.upsert.mockRejectedValue(new Error('db down'));
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow('db down');
    expect(dbMocks.application.create).not.toHaveBeenCalled();
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
