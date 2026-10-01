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
// The per-recipient application-email cap is a pass-through by default here; its own
// tests below swap in the REAL in-memory limiter or a failing one.
const consumeApplicationEmailQuotaMock = vi.fn();
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('ai'),
  consumeApplicationEmailQuota: (...a: unknown[]) => consumeApplicationEmailQuotaMock(...a),
}));

const processCvUploadMock = vi.fn();
vi.mock('../../packages/api/src/services/portal-application.service', () => ({
  portalApplicationService: { processCvUpload: (...a: unknown[]) => processCvUploadMock(...a) },
}));

const sendApplicationReceivedMock = vi.fn();
vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendApplicationReceived: (...a: unknown[]) => sendApplicationReceivedMock(...a) },
}));

const createPresignedPostMock = vi.fn();
vi.mock('../../packages/api/src/lib/s3', () => ({
  createCvUploadPresignedPost: (...a: unknown[]) => createPresignedPostMock(...a),
}));

// CV processing is never awaited by the response (#314). With no scheduler in ctx it runs
// as a detached promise; this drains it so assertions about it are not vacuous.
const flushDetached = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function makeCaller(
  headers: Headers = new Headers(),
  extraCtx: { runAfterResponse?: (task: () => Promise<void>) => void } = {},
) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const testRouter = router({ portal: portalRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: null,
    headers,
    supabaseAuth: null,
    externalAuth: null,
    ...extraCtx,
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
    title: 'Analista de Datos',
    stages: [{ id: STAGE_ID, isDefault: true }],
    organization: { name: 'Acme' },
    company: { language: 'es' },
  });
  dbMocks.candidate.findMany.mockResolvedValue([]);
  dbMocks.candidate.create.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.dataConsent.findFirst.mockResolvedValue(null);
  dbMocks.dataConsent.upsert.mockResolvedValue({ id: 'consent-1', withdrawnAt: null });
  dbMocks.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMocks));
  sendApplicationReceivedMock.mockResolvedValue(true);
  consumeApplicationEmailQuotaMock.mockResolvedValue(true);
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

  it('the real server error for a superseded version maps to the client "reload the page" copy', async () => {
    const { applyErrorMessage } =
      await import('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/apply-error-message');
    const caller = await makeCaller();

    const err = await caller.portal
      .applyToVacancy({ ...baseApplyInput, consentTextVersion: 'portal-apply-1999-01-01' })
      .catch((e: unknown) => e);

    expect(applyErrorMessage(err, { applySubmitError: 'GENERIC', applyConsentVersionChanged: 'RELOAD' })).toBe(
      'RELOAD',
    );
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
  // semantics the router relies on, so the tests observe what is actually STORED:
  //  - `email: { equals, mode: 'insensitive' }` compiles to a Postgres `ILIKE` (measured on
  //    Prisma 6.8.2) — so `_` and `%` ARE wildcards unless backslash-escaped. The mock
  //    implements exactly that, so a router that trusts the query as "equality" fails here.
  //  - upsert = create when absent / apply `update` when present.
  type Row = Record<string, unknown>;
  type CandidateRow = { id: string; email: string; deletedAt?: Date | null };
  function ilikeMatches(value: string, pattern: string): boolean {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]!;
      if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else if (ch === '%') re += '.*';
      else if (ch === '_') re += '.';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`, 'is').test(value);
  }
  function seedDb(init: { candidates?: CandidateRow[]; consents?: Row[] }) {
    const state = {
      candidates: (init.candidates ?? []).map((c) => ({ deletedAt: null, ...c })),
      consents: (init.consents ?? []).map((c) => ({ ...c })),
    };
    dbMocks.candidate.findMany.mockImplementation(
      async (arg: { where: { organizationId: string; email: { equals: string; mode: string } } }) => {
        expect(arg.where.organizationId).toBe(ORG_ID);
        expect(arg.where.email.mode).toBe('insensitive');
        return state.candidates.filter((c) => ilikeMatches(c.email, arg.where.email.equals));
      },
    );
    dbMocks.candidate.create.mockImplementation(async (arg: { data: { email: string } }) => {
      const row = { id: `new-${state.candidates.length}`, email: arg.data.email, deletedAt: null };
      state.candidates.push(row);
      return { id: row.id };
    });
    dbMocks.dataConsent.findFirst.mockImplementation(
      async (arg: {
        where: {
          organizationId: string;
          consentType: string;
          subjectUserId: { in: string[] };
          withdrawnAt: { not: null };
        };
      }) =>
        state.consents.find(
          (c) =>
            c.organizationId === arg.where.organizationId &&
            c.consentType === arg.where.consentType &&
            arg.where.subjectUserId.in.includes(c.subjectUserId as string) &&
            c.withdrawnAt,
        ) ?? null,
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
    await flushDetached();
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
    await flushDetached();
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

  it('a withdrawn consent of ANOTHER type or ANOTHER org does not block (positive control)', async () => {
    seedDb({
      candidates: [existingAna],
      consents: [
        { ...withdrawnConsent(), consentType: 'ai_interview' },
        { ...withdrawnConsent(), organizationId: '99999999-9999-9999-9999-999999999999' },
      ],
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(dbMocks.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ candidateId: CANDIDATE_ID }) }),
    );
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

  // ── Exact identity: LIKE wildcards in the submitted email never match a stranger ──
  const stranger = { id: 'stranger-1', email: 'axb@x.com' };

  it('`a_b@x.com` does not attach to the existing `axb@x.com` candidate', async () => {
    const state = seedDb({ candidates: [stranger] });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      email: 'a_b@x.com',
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
    });

    expect(state.candidates.map((c) => c.email)).toEqual(['axb@x.com', 'a_b@x.com']);
    const appArg = dbMocks.application.create.mock.calls[0]![0] as { data: { candidateId: string } };
    expect(appArg.data.candidateId).toBe('new-1');
    const consentArg = dbMocks.dataConsent.upsert.mock.calls[0]![0] as { create: { subjectUserId: string } };
    expect(consentArg.create.subjectUserId).toBe('new-1');
    await flushDetached();
    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, 'new-1', `cv-uploads/${ORG_ID}/x.pdf`, 'x.pdf');
  });

  it('`_____@gmail.com` matches no arbitrary 5-character mailbox', async () => {
    const state = seedDb({ candidates: [{ id: 'stranger-2', email: 'abcde@gmail.com' }] });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: '_____@gmail.com' });

    expect(dbMocks.candidate.create).toHaveBeenCalledOnce();
    const appArg = dbMocks.application.create.mock.calls[0]![0] as { data: { candidateId: string } };
    expect(appArg.data.candidateId).not.toBe('stranger-2');
    expect(state.candidates).toHaveLength(2);
  });

  it("a stranger's withdrawal never blocks a wildcard-lookalike email", async () => {
    seedDb({ candidates: [stranger], consents: [{ ...withdrawnConsent(), subjectUserId: 'stranger-1' }] });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: 'a_b@x.com' });

    expect(dbMocks.application.create).toHaveBeenCalledOnce();
  });

  it('`%` in an email is rejected by input validation before any DB access', async () => {
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, email: '%@x.com' })).rejects.toThrow();
    expect(dbMocks.vacancy.findFirstOrThrow).not.toHaveBeenCalled();
    expect(dbMocks.candidate.findMany).not.toHaveBeenCalled();
  });

  it('escapes LIKE wildcards in the lookup itself (not only post-filtered)', async () => {
    seedDb({});
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: 'a_b@x.com' });

    const arg = dbMocks.candidate.findMany.mock.calls[0]![0] as { where: { email: { equals: string } } };
    expect(arg.where.email.equals).toBe('a\\_b@x.com');
  });

  it('an inexact row returned by the lookup (any collation/compile quirk) is never used', async () => {
    dbMocks.candidate.findMany.mockResolvedValue([{ id: 'stranger-1', email: 'axb@x.com', deletedAt: null }]);
    dbMocks.dataConsent.findFirst.mockImplementation(async (arg: { where: { subjectUserId: { in: string[] } } }) =>
      arg.where.subjectUserId.in.includes('stranger-1') ? { id: 'withdrawn-stranger' } : null,
    );
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: 'a_b@x.com' });

    expect(dbMocks.candidate.create).toHaveBeenCalledOnce();
    expect(dbMocks.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ candidateId: CANDIDATE_ID }) }),
    );
  });

  it('positive control: a real case variant is still reused (no new candidate)', async () => {
    seedDb({ candidates: [{ id: CANDIDATE_ID, email: 'ANA@Example.com' }] });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy({ ...baseApplyInput, email: 'ana@example.com' });

    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
    expect(dbMocks.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ candidateId: CANDIDATE_ID }) }),
    );
  });

  // ── Soft-deleted candidates: never reused or revived; a withdrawal on one still blocks ──
  it('only a soft-deleted match: acknowledged with no candidate/consent/application write and no CV', async () => {
    const state = seedDb({ candidates: [{ ...existingAna, deletedAt: new Date('2026-01-01') }] });
    const caller = await makeCaller();

    const res = await caller.portal.applyToVacancy({ ...baseApplyInput, cvFileKey: `cv-uploads/${ORG_ID}/x.pdf` });

    expect(res).toEqual({ received: true });
    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
    expect(dbMocks.dataConsent.upsert).not.toHaveBeenCalled();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
    await flushDetached();
    expect(processCvUploadMock).not.toHaveBeenCalled();
    expect(state.candidates).toHaveLength(1);
  });

  it('a soft-deleted and an active case variant: the ACTIVE one is reused', async () => {
    seedDb({
      candidates: [
        { id: 'deleted-1', email: 'ana@example.com', deletedAt: new Date('2026-01-01') },
        { id: 'active-1', email: 'Ana@Example.com' },
      ],
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(dbMocks.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ candidateId: 'active-1' }) }),
    );
  });

  it('a withdrawal recorded on a soft-deleted variant still blocks', async () => {
    seedDb({
      candidates: [
        { id: 'deleted-1', email: 'ana@example.com', deletedAt: new Date('2026-01-01') },
        { id: 'active-1', email: 'Ana@Example.com' },
      ],
      consents: [{ ...withdrawnConsent(), subjectUserId: 'deleted-1' }],
    });
    const caller = await makeCaller();

    await caller.portal.applyToVacancy(baseApplyInput);

    expect(dbMocks.application.create).not.toHaveBeenCalled();
  });

  // ── P2002 race on concurrent submits ──
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

  it('P2002 when the winner already applied to this vacancy: acknowledgment, no retry', async () => {
    seedDb({ candidates: [existingAna] });
    dbMocks.$transaction.mockImplementationOnce(async () => {
      throw p2002();
    });
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();

    const res = await caller.portal.applyToVacancy(baseApplyInput);

    expect(res).toEqual({ received: true });
    expect(dbMocks.$transaction).toHaveBeenCalledOnce();
    expect(dbMocks.application.findFirst).toHaveBeenCalledWith({
      where: { vacancyId: VACANCY_ID, candidateId: { in: [CANDIDATE_ID] } },
      select: { id: true },
    });
  });

  it('P2002 with no application for this vacancy: retries once and creates the application', async () => {
    seedDb({});
    dbMocks.$transaction.mockImplementationOnce(async () => {
      throw p2002();
    });
    const caller = await makeCaller();

    const res = await caller.portal.applyToVacancy(baseApplyInput);

    expect(res).toEqual({ received: true });
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(2);
    expect(dbMocks.application.create).toHaveBeenCalledOnce();
  });

  it('a second P2002 on the retry propagates (no infinite retry)', async () => {
    seedDb({});
    dbMocks.$transaction.mockImplementation(async () => {
      throw p2002();
    });
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow();
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('a non-P2002 transaction error propagates without retry', async () => {
    dbMocks.$transaction.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow('db down');
    expect(dbMocks.$transaction).toHaveBeenCalledOnce();
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
    dbMocks.candidate.findMany.mockResolvedValue([{ id: CANDIDATE_ID, email: baseApplyInput.email, deletedAt: null }]);
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

    await flushDetached();

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, `cv-uploads/${ORG_ID}/x.pdf`, 'resume.pdf');
  });

  it('falls back to the key basename when cvFileName is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`,
    });

    await flushDetached();

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, `cv-uploads/${ORG_ID}/x.pdf`, 'x.pdf');
  });

  it('never processes a CV when cvFileKey is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy(baseApplyInput);

    await flushDetached();

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
    await flushDetached();
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
    await flushDetached();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });
});

describe('portal.applyToVacancy — CV processing never delays the response (#314)', () => {
  const cvInput = { ...baseApplyInput, cvFileKey: `cv-uploads/${ORG_ID}/x.pdf`, cvFileName: 'resume.pdf' };

  it('responds before CV processing runs: the task is handed to the post-response scheduler', async () => {
    const tasks: Array<() => Promise<void>> = [];
    const caller = await makeCaller(new Headers(), { runAfterResponse: (t) => tasks.push(t) });

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });

    // Resolved with nothing started: processing happens only when the scheduler runs it.
    expect(processCvUploadMock).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, `cv-uploads/${ORG_ID}/x.pdf`, 'resume.pdf');
  });

  it('a CV extractor that never settles does not delay the response (scheduler wired)', async () => {
    processCvUploadMock.mockImplementation(() => new Promise(() => {}));
    const caller = await makeCaller(new Headers(), { runAfterResponse: (t) => void t() });

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });
    expect(processCvUploadMock).toHaveBeenCalledTimes(1);
  });

  it('a CV extractor that never settles does not delay the response (no scheduler: detached fallback)', async () => {
    processCvUploadMock.mockImplementation(() => new Promise(() => {}));
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });
    await flushDetached();
    expect(processCvUploadMock).toHaveBeenCalledTimes(1);
  });

  it('a rejecting CV task stays non-fatal and logs no PII', async () => {
    const { logger } = await import('@tims/shared');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    processCvUploadMock.mockRejectedValue(new Error('boom ana@example.com'));
    const tasks: Array<() => Promise<void>> = [];
    const caller = await makeCaller(new Headers(), { runAfterResponse: (t) => tasks.push(t) });

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });
    await expect(tasks[0]!()).resolves.toBeUndefined();

    const cvWarn = warn.mock.calls.find((c) => String(c[1]).includes('CV processing'));
    expect(cvWarn).toBeDefined();
    const serialized = JSON.stringify(cvWarn);
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain(CANDIDATE_ID);
  });

  it('a scheduler that throws falls back to detached execution; the application still succeeds', async () => {
    const caller = await makeCaller(new Headers(), {
      runAfterResponse: () => {
        throw new Error('after() called outside a request scope');
      },
    });

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });
    await flushDetached();
    expect(processCvUploadMock).toHaveBeenCalledTimes(1);
  });

  it('duplicate, withdrawn and soft-deleted submissions schedule nothing', async () => {
    const schedule = vi.fn();
    const caller = await makeCaller(new Headers(), { runAfterResponse: schedule });

    dbMocks.application.findFirst.mockResolvedValueOnce({ id: APPLICATION_ID });
    await caller.portal.applyToVacancy(cvInput);

    dbMocks.candidate.findMany.mockResolvedValueOnce([{ id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: null }]);
    dbMocks.dataConsent.findFirst.mockResolvedValueOnce({ id: 'withdrawn-1' });
    await caller.portal.applyToVacancy(cvInput);

    dbMocks.candidate.findMany.mockResolvedValueOnce([{ id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: new Date() }]);
    await caller.portal.applyToVacancy(cvInput);

    await flushDetached();
    expect(schedule).not.toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });

  it('the application-received email is still sent when CV processing hangs', async () => {
    processCvUploadMock.mockImplementation(() => new Promise(() => {}));
    const caller = await makeCaller(new Headers(), { runAfterResponse: (t) => void t() });

    await expect(caller.portal.applyToVacancy(cvInput)).resolves.toEqual({ received: true });
    await flushDetached();
    expect(consumeApplicationEmailQuotaMock).toHaveBeenCalledWith('ana@example.com');
    expect(sendApplicationReceivedMock).toHaveBeenCalledTimes(1);
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

// Application-received confirmation (#308), on top of main's consent / identity / P2002
// semantics: the public response is always the same acknowledgment, and ONLY a new,
// committed application sends — never a duplicate, withdrawn/deleted refusal or the
// P2002 idempotent path.
describe('portal.applyToVacancy — application received email', () => {
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it('emails the candidate a confirmation after a new application is created', async () => {
    const caller = await makeCaller();
    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, email: 'Ana@Example.com' })).resolves.toEqual({
      received: true,
    });

    await vi.waitFor(() => expect(sendApplicationReceivedMock).toHaveBeenCalledOnce());
    expect(sendApplicationReceivedMock).toHaveBeenCalledWith({
      candidateEmail: 'ana@example.com',
      candidateName: 'Ana',
      vacancyTitle: 'Analista de Datos',
      companyName: 'Acme',
      locale: 'es',
    });
    expect(dbMocks.application.create.mock.invocationCallOrder[0]).toBeLessThan(
      sendApplicationReceivedMock.mock.invocationCallOrder[0]!,
    );
  });

  it('uses the English template for an English-language company', async () => {
    dbMocks.vacancy.findFirstOrThrow.mockResolvedValue({
      id: VACANCY_ID,
      organizationId: ORG_ID,
      title: 'Data Analyst',
      stages: [{ id: STAGE_ID, isDefault: true }],
      organization: { name: 'Acme' },
      company: { language: 'en-US' },
    });
    const caller = await makeCaller();
    await caller.portal.applyToVacancy(baseApplyInput);
    await vi.waitFor(() => expect(sendApplicationReceivedMock).toHaveBeenCalledOnce());
    expect(sendApplicationReceivedMock.mock.calls[0]![0]).toMatchObject({ locale: 'en', vacancyTitle: 'Data Analyst' });
  });

  it('a reused candidate is addressed by its STORED email + name, never the unauthenticated form values', async () => {
    dbMocks.candidate.findMany.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'ANA@example.com', firstName: 'Ana María', deletedAt: null },
    ]);
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({ ...baseApplyInput, firstName: 'Impersonator' });

    await vi.waitFor(() => expect(sendApplicationReceivedMock).toHaveBeenCalledOnce());
    expect(sendApplicationReceivedMock.mock.calls[0]![0]).toMatchObject({
      candidateEmail: 'ANA@example.com',
      candidateName: 'Ana María',
    });
    expect(dbMocks.candidate.create).not.toHaveBeenCalled();
  });

  it('still acknowledges when the email send throws (sync or async), logging no PII', async () => {
    const { logger } = await import('@tims/shared');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const caller = await makeCaller();
    sendApplicationReceivedMock.mockImplementationOnce(() => {
      throw new Error('SES exploded for ana@example.com');
    });
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });
    sendApplicationReceivedMock.mockRejectedValueOnce(new Error('SES down for ana@example.com'));
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });
    await vi.waitFor(() => expect(sendApplicationReceivedMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('ana@example.com');
    expect(logged).not.toContain('Ana');
    expect(logged).not.toContain(CANDIDATE_ID);
  });

  it('sends no confirmation for a duplicate application', async () => {
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });
    await settle();
    expect(sendApplicationReceivedMock).not.toHaveBeenCalled();
  });

  it('sends no confirmation when consent was withdrawn or the candidate is soft-deleted', async () => {
    const caller = await makeCaller();
    dbMocks.candidate.findMany.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: null },
    ]);
    dbMocks.dataConsent.findFirst.mockResolvedValue({ id: 'consent-withdrawn' });
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });

    dbMocks.dataConsent.findFirst.mockResolvedValue(null);
    dbMocks.candidate.findMany.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });

    await settle();
    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(sendApplicationReceivedMock).not.toHaveBeenCalled();
  });

  it('sends no confirmation on the P2002 idempotent path (the winner already applied)', async () => {
    dbMocks.$transaction.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });
    dbMocks.candidate.findMany.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'ana@example.com', firstName: 'Ana', deletedAt: null },
    ]);
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();
    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });
    await settle();
    expect(sendApplicationReceivedMock).not.toHaveBeenCalled();
  });

  // #308 security fix: the form chooses the recipient, so at most one confirmation per
  // address per 24h. Uses the REAL limiter (no UPSTASH_* env in tests → the in-memory
  // fallback) with an address unique to this test so the module-level store is isolated.
  it('caps the confirmation per recipient: a second application from the same address sends nothing but still succeeds', async () => {
    const actual = await vi.importActual<typeof import('../../packages/api/src/middleware/rate-limit')>(
      '../../packages/api/src/middleware/rate-limit',
    );
    consumeApplicationEmailQuotaMock.mockImplementation((addr: string) => actual.consumeApplicationEmailQuota(addr));
    const address = `cap-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy({ ...baseApplyInput, email: address })).resolves.toEqual({ received: true });
    await vi.waitFor(() => expect(sendApplicationReceivedMock).toHaveBeenCalledOnce());

    // Same address, different case, to another vacancy (a fresh application) — no second send.
    await expect(
      caller.portal.applyToVacancy({ ...baseApplyInput, email: address.toUpperCase() }),
    ).resolves.toEqual({ received: true });
    expect(dbMocks.application.create).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(consumeApplicationEmailQuotaMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(sendApplicationReceivedMock).toHaveBeenCalledOnce();
    // The limiter key is a hash — the raw address is never what the limiter is keyed on
    // beyond this call boundary (asserted in tests/ratelimit/application-email-cap.test.ts).
  });

  it('skips the confirmation (no PII logged) when the limiter is unavailable, and the application still succeeds', async () => {
    const { logger } = await import('@tims/shared');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    consumeApplicationEmailQuotaMock.mockRejectedValue(new Error('Upstash unreachable for ana@example.com'));
    const caller = await makeCaller();

    await expect(caller.portal.applyToVacancy(baseApplyInput)).resolves.toEqual({ received: true });
    expect(dbMocks.application.create).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'portal' }),
        expect.stringContaining('per-recipient cap reached or limiter unavailable'),
      ),
    );
    await settle();
    expect(sendApplicationReceivedMock).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('ana@example.com');
    expect(logged).not.toContain('Ana');
  });

  it('sends no confirmation when the application insert fails', async () => {
    dbMocks.application.create.mockRejectedValue(new Error('insert failed'));
    const caller = await makeCaller();
    await expect(caller.portal.applyToVacancy(baseApplyInput)).rejects.toThrow();
    await settle();
    expect(sendApplicationReceivedMock).not.toHaveBeenCalled();
  });
});
