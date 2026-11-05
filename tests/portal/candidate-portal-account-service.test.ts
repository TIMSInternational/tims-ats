import { beforeEach, describe, expect, it, vi } from 'vitest';

// Audit C-33 — server side of the candidate's account actions. Identity is the session email; the org is the
// route slug; every write is scoped to (org, candidate) and conditional, so it cannot touch another candidate's
// row nor overwrite a hire or a rejection.

const repo = vi.hoisted(() => ({
  findOrgBySlug: vi.fn(),
  findActiveCandidate: vi.fn(),
  updateCandidateProfile: vi.fn(),
  withdrawApplication: vi.fn(),
  findOwnApplicationStatus: vi.fn(),
}));
const tenantDb = vi.hoisted(() => ({
  candidate: { updateMany: vi.fn(), findFirst: vi.fn() },
  application: { updateMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('@tims/db', () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  db: {},
  tenantDb,
}));
vi.mock('@tims/ai', () => ({ answerCandidateFaq: vi.fn() }));

const ORG = { id: 'org-1', name: 'Acme', isActive: true };
const EMAIL = 'ana@example.com';
const APP_ID = '22222222-2222-4222-8222-222222222222';

describe('candidatePortalService account actions', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../../packages/api/src/repositories/candidate-portal.repository', () => ({ candidatePortalRepo: repo }));
    repo.findOrgBySlug.mockResolvedValue(ORG);
    repo.findActiveCandidate.mockResolvedValue({ id: 'cand-1' });
  });

  const service = async () =>
    (await import('../../packages/api/src/services/candidate-portal.service')).candidatePortalService;

  describe('withdrawMyApplication', () => {
    it("withdraws the session candidate's own application, scoped to org and candidate", async () => {
      repo.withdrawApplication.mockResolvedValue(1);
      const result = await (await service()).withdrawMyApplication(EMAIL, 'acme', APP_ID);
      expect(result).toEqual({ id: APP_ID, status: 'withdrawn' });
      expect(repo.findActiveCandidate).toHaveBeenCalledWith('org-1', EMAIL);
      expect(repo.withdrawApplication).toHaveBeenCalledWith('org-1', 'cand-1', APP_ID);
    });

    it('NOT_FOUND for an unknown org, without touching candidate data', async () => {
      repo.findOrgBySlug.mockResolvedValue(null);
      await expect((await service()).withdrawMyApplication(EMAIL, 'nope', APP_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.withdrawApplication).not.toHaveBeenCalled();
    });

    it('NOT_FOUND when the session email has no candidate here', async () => {
      repo.findActiveCandidate.mockResolvedValue(null);
      await expect((await service()).withdrawMyApplication(EMAIL, 'acme', APP_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.withdrawApplication).not.toHaveBeenCalled();
    });

    it("NOT_FOUND when the application is not this candidate's (never reveals it exists)", async () => {
      repo.withdrawApplication.mockResolvedValue(0);
      repo.findOwnApplicationStatus.mockResolvedValue(null);
      await expect((await service()).withdrawMyApplication(EMAIL, 'acme', APP_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.findOwnApplicationStatus).toHaveBeenCalledWith('org-1', 'cand-1', APP_ID);
    });

    it.each(['rejected', 'hired', 'withdrawn'])('CONFLICT when the application is already %s', async (status) => {
      repo.withdrawApplication.mockResolvedValue(0);
      repo.findOwnApplicationStatus.mockResolvedValue({ status });
      await expect((await service()).withdrawMyApplication(EMAIL, 'acme', APP_ID)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('PRECONDITION_FAILED when it is still active but an offer for the vacancy is open', async () => {
      repo.withdrawApplication.mockResolvedValue(0);
      repo.findOwnApplicationStatus.mockResolvedValue({ status: 'active' });
      await expect((await service()).withdrawMyApplication(EMAIL, 'acme', APP_ID)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('updateMyProfile', () => {
    const input = { firstName: 'Ana', lastName: 'Gómez', phone: '', location: '' };

    it('stores an empty phone/location as null and returns the saved details', async () => {
      const saved = { firstName: 'Ana', lastName: 'Gómez', phone: null, location: null };
      repo.updateCandidateProfile.mockResolvedValue(saved);
      await expect((await service()).updateMyProfile(EMAIL, 'acme', input)).resolves.toEqual(saved);
      expect(repo.updateCandidateProfile).toHaveBeenCalledWith('org-1', 'cand-1', {
        firstName: 'Ana',
        lastName: 'Gómez',
        phone: null,
        location: null,
      });
    });

    it('NOT_FOUND without a candidate, or when the record stopped being active meanwhile', async () => {
      repo.findActiveCandidate.mockResolvedValueOnce(null);
      await expect((await service()).updateMyProfile(EMAIL, 'acme', input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(repo.updateCandidateProfile).not.toHaveBeenCalled();

      repo.updateCandidateProfile.mockResolvedValue(null);
      await expect((await service()).updateMyProfile(EMAIL, 'acme', input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('getContactEmail: candidate contact, then billing email, never a vendor default', async () => {
    const s = await service();
    expect(
      s.getContactEmail({ settings: { candidateContactEmail: 'Seleccion@Acme.test' }, billingEmail: 'b@acme.test' }),
    ).toBe('seleccion@acme.test');
    expect(s.getContactEmail({ settings: {}, billingEmail: 'b@acme.test' })).toBe('b@acme.test');
    expect(s.getContactEmail({ settings: null, billingEmail: null })).toBeNull();
  });
});

describe('candidatePortalRepo writes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('../../packages/api/src/repositories/candidate-portal.repository');
  });

  const realRepo = async () =>
    (await import('../../packages/api/src/repositories/candidate-portal.repository')).candidatePortalRepo;

  it('withdraws only an active application of this candidate at this org with no open offer for the vacancy', async () => {
    tenantDb.application.updateMany.mockResolvedValue({ count: 1 });
    await expect((await realRepo()).withdrawApplication('org-1', 'cand-1', APP_ID)).resolves.toBe(1);
    expect(tenantDb.application.updateMany).toHaveBeenCalledWith({
      where: {
        id: APP_ID,
        candidateId: 'cand-1',
        organizationId: 'org-1',
        status: 'active',
        vacancy: { offers: { none: { candidateId: 'cand-1', status: { in: ['sent', 'accepted'] } } } },
      },
      data: { status: 'withdrawn' },
    });
  });

  it('edits only name/phone/location of an active, non-deleted candidate of this org, read back with select', async () => {
    tenantDb.candidate.updateMany.mockResolvedValue({ count: 1 });
    tenantDb.candidate.findFirst.mockResolvedValue({ firstName: 'Ana', lastName: 'G', phone: null, location: null });
    const data = { firstName: 'Ana', lastName: 'G', phone: null, location: null };
    await (await realRepo()).updateCandidateProfile('org-1', 'cand-1', data);
    expect(tenantDb.candidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', organizationId: 'org-1', isActive: true, deletedAt: null },
      data,
    });
    expect(tenantDb.candidate.findFirst).toHaveBeenCalledWith({
      where: { id: 'cand-1', organizationId: 'org-1' },
      select: { firstName: true, lastName: true, phone: true, location: true },
    });
  });

  it('returns null and reads nothing back when no candidate row matched', async () => {
    tenantDb.candidate.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      (await realRepo()).updateCandidateProfile('org-1', 'cand-1', {
        firstName: 'A',
        lastName: 'B',
        phone: null,
        location: null,
      }),
    ).resolves.toBeNull();
    expect(tenantDb.candidate.findFirst).not.toHaveBeenCalled();
  });
});

describe('profile input schema (router input)', () => {
  it('accepts a Costa Rican phone and trims; refuses an email field, junk phones and over-long values', async () => {
    const { candidatePortalProfileSchema } = await import('@tims/shared');
    const schema = candidatePortalProfileSchema.extend({ orgSlug: (await import('zod')).z.string() });
    const ok = schema.parse({
      orgSlug: 'acme',
      firstName: ' Ana ',
      lastName: 'Gómez',
      phone: ' +506 8888-7777 ',
      location: '',
    });
    expect(ok).toMatchObject({ firstName: 'Ana', phone: '+506 8888-7777' });

    const base = { orgSlug: 'acme', firstName: 'Ana', lastName: 'Gómez', phone: '', location: '' };
    expect(schema.safeParse({ ...base, email: 'otra@example.com' }).success).toBe(false);
    expect(schema.safeParse({ ...base, phone: 'llámeme' }).success).toBe(false);
    expect(schema.safeParse({ ...base, phone: '+-()' }).success).toBe(false);
    expect(schema.safeParse({ ...base, phone: '1'.repeat(31) }).success).toBe(false);
    expect(schema.safeParse({ ...base, firstName: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...base, location: 'x'.repeat(201) }).success).toBe(false);
  });
});
