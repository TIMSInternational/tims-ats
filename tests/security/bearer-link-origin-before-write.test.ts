import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PR #351 review fix (2): the bearer-link origin must be resolved and validated BEFORE any row that
// carries a live token is written. Previously getAppUrl() ran after the write, so a misconfigured
// NEXT_PUBLIC_APP_URL left orphan pending invitations / AI-interview sessions behind.

const repo = vi.hoisted(() => ({
  findOrganization: vi.fn(),
  createPending: vi.fn(),
  markSent: vi.fn(),
  findForResend: vi.fn(),
  markResent: vi.fn(),
}));
const sendEmailMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../packages/api/src/repositories/bulk-invitation.repository', () => ({ bulkInvitationRepository: repo }));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: sendEmailMock }));

const aiRepo = vi.hoisted(() => ({
  findInterviewWithContext: vi.fn(),
  createSession: vi.fn(),
  findSessionResult: vi.fn(),
  findSessionByCandidateToken: vi.fn(),
}));
const generateGuideMock = vi.hoisted(() => vi.fn());
vi.mock('../../packages/api/src/repositories/ai-interview.repository', () => ({ aiInterviewRepository: aiRepo }));
vi.mock('../../packages/ai/src/index', () => ({ generateInterviewGuide: generateGuideMock }));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: {
    isRecruitmentConsentWithdrawn: vi.fn(async () => false),
    withdrawnCandidateIds: vi.fn(async () => new Set<string>()),
  },
}));
vi.mock('../../packages/api/src/services/ai-interview-access.service', () => ({
  assertAiInterviewEnabled: vi.fn().mockResolvedValue({ enabled: true }),
  loadAiInterviewConfig: vi.fn().mockResolvedValue({ billableUsdPerMinute: 0.2 }),
  resolveMaxDurationSeconds: vi.fn().mockReturnValue(900),
  AI_VOICE_INTERVIEW_SLUG: 'ai-voice-interview',
  AI_INTERVIEW_DEFAULT_MAX_MINUTES: 15,
}));

import { bulkInviteUsers, resendInvitation } from '../../packages/api/src/services/bulk-invitation.service';
import { aiInterviewService } from '../../packages/api/src/services/ai-interview.service';
import { AppOriginConfigError } from '../../packages/shared/src/app-url';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INVALID_ORIGINS = ['https://ats.example.test/app', 'not a url', 'https://ats.example.test/?t=1'];

beforeEach(() => {
  vi.clearAllMocks();
  repo.findOrganization.mockResolvedValue({ name: 'Acme' });
  repo.createPending.mockImplementation(async (d: { email: string }) => ({ id: `inv-${d.email}` }));
  repo.markSent.mockResolvedValue({ count: 1 });
  repo.findForResend.mockResolvedValue({
    id: 'inv-1',
    token: 't',
    email: 'a@x.test',
    status: 'pending',
    organizationName: 'Acme',
    roleSlug: 'employee',
  });
  repo.markResent.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('bulk invitations validate the link origin before writing', () => {
  it.each(INVALID_ORIGINS)('throws and writes no pending invitation for %s', async (origin) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    await expect(
      bulkInviteUsers(ORG, 'inviter', [{ email: 'a@x.test' }, { email: 'b@x.test' }]),
    ).rejects.toBeInstanceOf(AppOriginConfigError);
    expect(repo.findOrganization).not.toHaveBeenCalled();
    expect(repo.createPending).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('throws on public http in production and writes nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://ats.example.test');
    await expect(bulkInviteUsers(ORG, 'inviter', [{ email: 'a@x.test' }])).rejects.toBeInstanceOf(AppOriginConfigError);
    expect(repo.createPending).not.toHaveBeenCalled();
  });

  it('resend fails before reading or re-stamping the invitation', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ats.example.test/app');
    await expect(resendInvitation('inv-1')).rejects.toBeInstanceOf(AppOriginConfigError);
    expect(repo.findForResend).not.toHaveBeenCalled();
    expect(repo.markResent).not.toHaveBeenCalled();
  });

  it('control: a trailing-slash origin is accepted and links are well-formed', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ats.example.test/');
    const out = await bulkInviteUsers(ORG, 'inviter', [{ email: 'a@x.test' }]);
    expect(out?.summary.sent).toBe(1);
    expect(repo.createPending).toHaveBeenCalledTimes(1);
    const html = (sendEmailMock.mock.calls[0] as unknown as [{ html: string }])[0].html;
    expect(html).toContain('https://ats.example.test/accept-invitation?token=');
    expect(html).not.toContain('https://ats.example.test//');
  });
});

describe('AI interview session validates the link origin before creating the session', () => {
  it('throws and neither generates a guide nor creates a session', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ats.example.test/app');
    await expect(
      aiInterviewService.createAiInterviewSession({ interviewId: 'i-1', organizationId: ORG, scopeWhere: {} }),
    ).rejects.toBeInstanceOf(AppOriginConfigError);
    expect(aiRepo.findInterviewWithContext).not.toHaveBeenCalled();
    expect(generateGuideMock).not.toHaveBeenCalled();
    expect(aiRepo.createSession).not.toHaveBeenCalled();
  });
});
