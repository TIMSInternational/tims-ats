import { beforeEach, describe, expect, it, vi } from 'vitest';

// #312 — staff paths that would put a withdrawn candidate back into processing: a staff-created application
// (candidate.applyToVacancy) and AI screening (candidate.screen). Both refuse with PRECONDITION_FAILED.

const m = vi.hoisted(() => ({
  withdrawn: vi.fn(async () => false),
  findFirstStage: vi.fn(),
  createApplication: vi.fn(),
  screen: vi.fn(),
  assertScoped: vi.fn(async () => undefined),
}));

vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { isRecruitmentConsentWithdrawn: m.withdrawn, withdrawnCandidateIds: vi.fn() },
}));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: { findFirstStage: m.findFirstStage, createApplication: m.createApplication },
}));
vi.mock('../../packages/api/src/services/candidate-ai.service', () => ({
  candidateAiService: { screenCandidate: m.screen },
}));
vi.mock('../../packages/api/src/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/api/src/access')>()),
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: m.assertScoped,
}));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const CANDIDATE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const VACANCY = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03';

beforeEach(() => {
  vi.clearAllMocks();
  m.findFirstStage.mockResolvedValue({ id: 'stage-1' });
  m.createApplication.mockResolvedValue({ id: 'app-1' });
  m.screen.mockResolvedValue({ ok: true });
});

describe('candidateService.applyToVacancy (staff)', () => {
  it('refuses a withdrawn candidate before creating anything', async () => {
    const { candidateService } = await import('../../packages/api/src/services/candidate.service');
    m.withdrawn.mockResolvedValueOnce(true);
    await expect(candidateService.applyToVacancy(ORG, CANDIDATE, VACANCY, 'manual')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'consent_withdrawn',
    });
    expect(m.withdrawn).toHaveBeenCalledWith(ORG, CANDIDATE);
    expect(m.createApplication).not.toHaveBeenCalled();
  });

  it('still creates the application when consent is active', async () => {
    const { candidateService } = await import('../../packages/api/src/services/candidate.service');
    await expect(candidateService.applyToVacancy(ORG, CANDIDATE, VACANCY, 'manual')).resolves.toEqual({ id: 'app-1' });
  });
});

describe('candidate.screen (AI scoring)', () => {
  async function caller() {
    const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
    const { candidateAiRouter } = await import('../../packages/api/src/routers/candidate/ai');
    return createCallerFactory(router({ candidate: candidateAiRouter }))({
      user: { id: 'u1', organizationId: ORG, roles: ['recruiter'], isPlatformOwner: false, impersonatorId: null, email: 'r@x.co', isActive: true },
      headers: new Headers(),
      supabaseAuth: null,
      externalAuth: null,
    } as never);
  }

  it('refuses a withdrawn candidate and never calls the AI agent', async () => {
    m.withdrawn.mockResolvedValueOnce(true);
    await expect((await caller()).candidate.screen({ candidateId: CANDIDATE, vacancyId: VACANCY })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'consent_withdrawn',
    });
    expect(m.screen).not.toHaveBeenCalled();
  });
});
