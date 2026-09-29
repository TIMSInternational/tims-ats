import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  APPLICATION_CONSENT_TEXT_VERSION,
  APPLICATION_CONSENT_TYPE,
} from '../../packages/shared/src/constants/application-consent';

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const APPLICATION_ID = '55555555-5555-5555-5555-555555555555';

const dbMocks = {
  vacancy: { findFirstOrThrow: vi.fn() },
  candidate: { findMany: vi.fn(), create: vi.fn() },
  dataConsent: { upsert: vi.fn(), findFirst: vi.fn() },
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
      applyToVacancy(input: Record<string, unknown>): Promise<unknown>;
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
  dbMocks.candidate.findMany.mockResolvedValue([]);
  dbMocks.candidate.create.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.dataConsent.findFirst.mockResolvedValue(null);
  dbMocks.dataConsent.upsert.mockResolvedValue({ id: 'consent-1', withdrawnAt: null });
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
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
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
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
  });
});

describe('portal.applyToVacancy — explicit data-processing consent (F14)', () => {
  it('rejects a submission without consent before writing any candidate data', async () => {
    const caller = await makeCaller();
    const { consentAccepted: _omit, ...withoutConsent } = baseApplyInput;

    await expect(caller.portal.applyToVacancy(withoutConsent)).rejects.toThrow();
    expect(dbMocks.vacancy.findFirstOrThrow).not.toHaveBeenCalled();
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });

  it('rejects consentAccepted: false', async () => {
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, consentAccepted: false })).rejects.toThrow(
      'Debes autorizar el tratamiento',
    );
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
  });

  it('rejects a superseded or missing consent text version', async () => {
    const caller = await makeCaller();
    const { consentTextVersion: _omit, ...withoutVersion } = baseApplyInput;

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, consentTextVersion: 'old' })).rejects.toThrow();
    await expect(caller.portal.applyToVacancy(withoutVersion)).rejects.toThrow();
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
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
      return { id: 'consent-1', withdrawnAt: null };
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
    // Insert-if-absent: an unauthenticated email claim must never rewrite existing evidence.
    expect(arg.update).toEqual({});
  });

  // A stateful stand-in for the candidates + data_consents tables, honouring the Prisma
  // semantics the router relies on (case-insensitive email equality, upsert = create when
  // absent / apply `update` when present), so the tests observe what is actually STORED.
  type Row = Record<string, unknown>;
  function seedDb(init: { candidates?: { id: string; email: string }[]; consents?: Row[] }) {
    const state = {
      candidates: [...(init.candidates ?? [])],
      consents: (init.consents ?? []).map((c) => ({ ...c })),
    };
    dbMocks.candidate.findMany.mockImplementation(
      async (arg: { where: { organizationId: string; email: { equals: string; mode: string } } }) => {
        expect(arg.where.organizationId).toBe(ORG_ID);
        expect(arg.where.email.mode).toBe('insensitive');
        return state.candidates.filter((c) => c.email.toLowerCase() === arg.where.email.equals.toLowerCase());
      },
    );
    dbMocks.candidate.create.mockImplementation(async (arg: { data: { email: string } }) => {
      const row = { id: `new-${state.candidates.length}`, email: arg.data.email };
      state.candidates.push(row);
      return { id: row.id };
    });
    dbMocks.dataConsent.findFirst.mockImplementation(
      async (arg: { where: { subjectUserId: { in: string[] } } }) =>
        state.consents.find((c) => arg.where.subjectUserId.in.includes(c.subjectUserId as string) && c.withdrawnAt) ??
        null,
    );
    dbMocks.dataConsent.upsert.mockImplementation(
      async (arg: { where: { subjectUserId_consentType: { subjectUserId: string } }; create: Row; update: Row }) => {
        const found = state.consents.find((c) => c.subjectUserId === arg.where.subjectUserId_consentType.subjectUserId);
        if (found) Object.assign(found, arg.update);
        else state.consents.push({ withdrawnAt: null, ...arg.create });
        return { id: 'consent-1' };
      },
    );
    return state;
  }

  const existingAna = { id: CANDIDATE_ID, email: 'ana@example.com' };
  const withdrawnConsent = () => ({
    organizationId: ORG_ID,
    subjectUserId: CANDIDATE_ID,
    consentType: APPLICATION_CONSENT_TYPE,
    textVersion: 'portal-apply-2025-01-01',
    agreedAt: new Date('2025-01-15T10:00:00.000Z'),
    withdrawnAt: new Date('2026-05-01T00:00:00.000Z'),
  });

  it('never overwrites an existing consent record (text version + agreedAt) from the unauthenticated form', async () => {
    const originalAgreedAt = new Date('2025-01-15T10:00:00.000Z');
    const state = seedDb({
      candidates: [existingAna],
      consents: [{ ...withdrawnConsent(), agreedAt: originalAgreedAt, withdrawnAt: null }],
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(state.consents).toHaveLength(1);
    expect(state.consents[0]).toMatchObject({ textVersion: 'portal-apply-2025-01-01', withdrawnAt: null });
    expect(state.consents[0]!.agreedAt).toBe(originalAgreedAt);
    expect(dbMocks.application.create).toHaveBeenCalledOnce();
  });

  it('a duplicate submission for an existing candidate writes no consent evidence', async () => {
    const state = seedDb({ candidates: [existingAna] });
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(dbMocks.dataConsent.upsert).not.toHaveBeenCalled();
    expect(state.consents).toHaveLength(0);
    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });

  it('withdrawn consent: no candidate/consent/application write and no CV processing', async () => {
    const state = seedDb({ candidates: [existingAna], consents: [withdrawnConsent()] });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, cvFileKey: `cv-uploads/${ORG_ID}/x.pdf` });

    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
    expect(dbMocks.dataConsent.upsert).not.toHaveBeenCalled();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
    expect(state.consents[0]!.withdrawnAt).toEqual(new Date('2026-05-01T00:00:00.000Z'));
  });

  it('a case-variant email cannot bypass a withdrawal (either direction)', async () => {
    const caller = await makeCaller();

    seedDb({ candidates: [existingAna], consents: [withdrawnConsent()] });
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      email: 'Ana@EXAMPLE.COM',
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
    });

    // Legacy / staff-entered mixed-case row, lowercase submission.
    seedDb({ candidates: [{ id: CANDIDATE_ID, email: 'ANA@Example.com' }], consents: [withdrawnConsent()] });
    await caller.portal.applyToVacancy({ ...baseApplyInput, cvFileKey: `cv-uploads/${ORG_ID}/x.pdf` });

    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });

  it('blocks when ANY case-variant candidate in the org has withdrawn consent', async () => {
    seedDb({
      candidates: [existingAna, { id: 'variant-2', email: 'Ana@Example.com' }],
      consents: [{ ...withdrawnConsent(), subjectUserId: 'variant-2' }],
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });

  it('stores a new candidate under the canonical (lowercased) email', async () => {
    const state = seedDb({});
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: 'New.Person@Example.COM' });

    expect(state.candidates.map((c) => c.email)).toEqual(['new.person@example.com']);
  });

  it('new, duplicate and withdrawn-refused submissions return the identical public acknowledgment', async () => {
    const caller = await makeCaller();

    seedDb({});
    const fresh = await caller.portal.applyToVacancy(baseApplyInput);

    seedDb({ candidates: [existingAna] });
    dbMocks.application.findFirst.mockResolvedValueOnce({ id: APPLICATION_ID });
    const duplicate = await caller.portal.applyToVacancy(baseApplyInput);

    seedDb({ candidates: [existingAna], consents: [withdrawnConsent()] });
    const withdrawn = await caller.portal.applyToVacancy(baseApplyInput);

    expect(fresh).toEqual({ received: true });
    expect(duplicate).toEqual(fresh);
    expect(withdrawn).toEqual(fresh);
    expect(dbMocks.application.create).toHaveBeenCalledOnce(); // only the fresh one
  });

  it('does not create the application when recording consent fails', async () => {
    dbMocks.dataConsent.upsert.mockRejectedValue(new Error('db down'));
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow('db down');
    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });
});

describe('portal.applyToVacancy — CV processing', () => {
  it('does not create or overwrite an existing candidate profile based on an unauthenticated email claim', async () => {
    dbMocks.candidate.findMany.mockResolvedValue([{ id: CANDIDATE_ID, email: baseApplyInput.email }]);
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({ ...baseApplyInput, firstName: 'Impersonator' });

    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
    expect(dbMocks.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ candidateId: CANDIDATE_ID }) }),
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
