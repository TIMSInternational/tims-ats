import { beforeEach, describe, expect, it, vi } from 'vitest';

// #312 — after a withdrawal the candidate receives no further processing emails. The status read is
// the privileged client with an explicit organization filter (a tenantDb read outside a tenant
// context would see no rows and fail OPEN), and the interview mailer drops only the candidate.

const m = vi.hoisted(() => ({
  consentFindFirst: vi.fn(),
  interviewFindFirst: vi.fn(),
  orgFindFirst: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: { dataConsent: { findFirst: m.consentFindFirst } },
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
  m.consentFindFirst.mockResolvedValue(null);
  m.interviewFindFirst.mockResolvedValue(interview);
  m.orgFindFirst.mockResolvedValue({ name: 'Acme', billingEmail: 'hr@acme.test' });
});

describe('candidateConsentRepository.isRecruitmentConsentWithdrawn', () => {
  it('matches only a withdrawn recruitment consent of that candidate in that org', async () => {
    const { candidateConsentRepository } = await import(
      '../../packages/api/src/repositories/candidate-consent.repository'
    );
    m.consentFindFirst.mockResolvedValueOnce({ id: 'c1' });
    await expect(candidateConsentRepository.isRecruitmentConsentWithdrawn(ORG_ID, CANDIDATE_ID)).resolves.toBe(true);
    expect(m.consentFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        subjectUserId: CANDIDATE_ID,
        consentType: 'recruitment_data_processing',
        withdrawnAt: { not: null },
      },
      select: { id: true },
    });
    await expect(candidateConsentRepository.isRecruitmentConsentWithdrawn(ORG_ID, CANDIDATE_ID)).resolves.toBe(false);
  });
});

describe('interview emails after a withdrawal', () => {
  it('the notification read carries the candidate consent status', async () => {
    const { interviewEmailRepository } = await import('../../packages/api/src/repositories/interview-email.repository');
    m.consentFindFirst.mockResolvedValueOnce({ id: 'c1' });
    const data = await interviewEmailRepository.findForNotification(ORG_ID, INTERVIEW_ID);
    expect(data?.candidateConsentWithdrawn).toBe(true);
    expect(m.consentFindFirst.mock.calls[0]![0]).toMatchObject({
      where: { organizationId: ORG_ID, subjectUserId: CANDIDATE_ID },
    });
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
