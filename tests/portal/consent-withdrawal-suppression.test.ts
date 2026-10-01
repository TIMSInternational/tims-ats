import { beforeEach, describe, expect, it, vi } from 'vitest';

// #312 — after a withdrawal the candidate receives no further processing emails. The status read is
// the privileged client with an explicit organization filter (a tenantDb read outside a tenant
// context would see no rows and fail OPEN), and the interview mailer drops only the candidate.

const m = vi.hoisted(() => ({
  consentFindMany: vi.fn(),
  candidateFindMany: vi.fn(),
  interviewFindFirst: vi.fn(),
  orgFindFirst: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: { dataConsent: { findMany: m.consentFindMany }, candidate: { findMany: m.candidateFindMany } },
  tenantDb: { interview: { findFirst: m.interviewFindFirst }, organization: { findFirst: m.orgFindFirst } },
}));

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const INTERVIEW_ID = '22222222-2222-2222-2222-222222222222';

const interview = {
  id: INTERVIEW_ID,
  type: 'onsite',
  status: 'scheduled',
  scheduledAt: new Date('2026-10-01T15:00:00Z'),
  duration: 60,
  location: 'Calle 1, Bogotá',
  meetingUrl: null,
  cancelReason: null,
  updatedAt: new Date('2026-09-29T10:00:00Z'),
  candidate: { id: CANDIDATE_ID, firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' },
  vacancy: { title: 'Analista', company: { language: 'es', timezone: 'America/Bogota' } },
  evaluators: [
    {
      user: {
        id: 'eval-1',
        firstName: 'Eva',
        lastName: 'Lu',
        email: 'eva@acme.test',
        locale: 'es',
        timezone: 'America/Bogota',
        isActive: true,
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.consentFindMany.mockResolvedValue([]);
  m.candidateFindMany.mockImplementation(async (args: { where: { id?: unknown } }) =>
    args.where.id ? [{ id: CANDIDATE_ID, email: 'Ana@Example.com ' }] : [],
  );
  m.interviewFindFirst.mockResolvedValue(interview);
  m.orgFindFirst.mockResolvedValue({ name: 'Acme', billingEmail: 'hr@acme.test' });
});

describe('candidateConsentRepository — every case variant of the email', () => {
  const VARIANT = '44444444-4444-4444-4444-444444444444';

  it('a withdrawal recorded on ANOTHER row with the same email (any case) covers this candidate', async () => {
    const { candidateConsentRepository } = await import(
      '../../packages/api/src/repositories/candidate-consent.repository'
    );
    m.candidateFindMany.mockImplementation(async (args: { where: { id?: unknown } }) =>
      args.where.id
        ? [{ id: CANDIDATE_ID, email: 'Ana@Example.com ' }]
        : [
            { id: CANDIDATE_ID, email: 'Ana@Example.com ' },
            { id: VARIANT, email: 'ana@example.com' },
            { id: 'neighbour', email: 'a_a@example.com' },
          ],
    );
    m.consentFindMany.mockResolvedValue([{ subjectUserId: VARIANT }]);

    await expect(candidateConsentRepository.isRecruitmentConsentWithdrawn(ORG_ID, CANDIDATE_ID)).resolves.toBe(true);
    const consentWhere = m.consentFindMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(consentWhere.where).toMatchObject({
      organizationId: ORG_ID,
      consentType: 'recruitment_data_processing',
      withdrawnAt: { not: null },
    });
    // The neighbour row only matched a LIKE wildcard; it is never part of the identity.
    expect((consentWhere.where.subjectUserId as { in: string[] }).in.sort()).toEqual([CANDIDATE_ID, VARIANT].sort());
    // The variant lookup is an escaped, exact, case-insensitive match within the org.
    const variantWhere = m.candidateFindMany.mock.calls[1]![0] as { where: Record<string, unknown> };
    expect(variantWhere.where).toMatchObject({
      organizationId: ORG_ID,
      OR: [{ email: { equals: 'ana@example.com', mode: 'insensitive' } }],
    });
  });

  it('no withdrawn row on any variant → not withdrawn; batch returns only the withdrawn subset', async () => {
    const { candidateConsentRepository } = await import(
      '../../packages/api/src/repositories/candidate-consent.repository'
    );
    await expect(candidateConsentRepository.isRecruitmentConsentWithdrawn(ORG_ID, CANDIDATE_ID)).resolves.toBe(false);

    m.candidateFindMany.mockImplementation(async (args: { where: { id?: unknown } }) =>
      args.where.id
        ? [
            { id: 'c1', email: 'a@x.co' },
            { id: 'c2', email: 'b@x.co' },
          ]
        : [
            { id: 'c1', email: 'a@x.co' },
            { id: 'c2', email: 'b@x.co' },
          ],
    );
    m.consentFindMany.mockResolvedValue([{ subjectUserId: 'c2' }]);
    await expect(candidateConsentRepository.withdrawnCandidateIds(ORG_ID, ['c1', 'c2'])).resolves.toEqual(new Set(['c2']));
  });
});

describe('interview emails after a withdrawal', () => {
  it('the notification read carries the candidate consent status', async () => {
    const { interviewEmailRepository } = await import('../../packages/api/src/repositories/interview-email.repository');
    m.consentFindMany.mockResolvedValueOnce([{ subjectUserId: CANDIDATE_ID }]);
    const data = await interviewEmailRepository.findForNotification(ORG_ID, INTERVIEW_ID);
    expect(data?.candidateConsentWithdrawn).toBe(true);
  });

  it('builds only the evaluator messages when the candidate withdrew', async () => {
    const { buildInterviewEmails } = await import('../../packages/api/src/services/interview-email.service');
    const params = { orgId: ORG_ID, interviewId: INTERVIEW_ID, kind: 'invite' as const, candidateJoinToken: null };
    const withdrawn = buildInterviewEmails(
      { interview, org: { name: 'Acme', billingEmail: 'hr@acme.test' }, candidateConsentWithdrawn: true } as never,
      params,
      'https://ats.example.test',
    );
    expect(withdrawn.messages.map((msg) => msg.to)).toEqual(['eva@acme.test']);

    const active = buildInterviewEmails(
      { interview, org: { name: 'Acme', billingEmail: 'hr@acme.test' }, candidateConsentWithdrawn: false } as never,
      params,
      'https://ats.example.test',
    );
    expect(active.messages.map((msg) => msg.to).sort()).toEqual(['ana@example.com', 'eva@acme.test']);
  });
});
