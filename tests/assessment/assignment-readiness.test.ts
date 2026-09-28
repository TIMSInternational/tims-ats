import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../packages/api/src/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/api/src/access')>();
  return {
    ...actual,
    buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['recruiter'] }),
    createAnchorLoader: vi.fn().mockReturnValue(null),
    assertScoped: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

vi.mock('../../packages/api/src/services/email.service', () => ({
  emailService: { sendAssessmentReminder: vi.fn() },
}));

vi.mock('@tims/db', () => ({
  db: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
  tenantDb: {
    assessmentType: { findFirst: vi.fn() },
    assessmentQuestion: { count: vi.fn() },
    organization: { findFirst: vi.fn() },
    candidate: { findFirst: vi.fn(), count: vi.fn() },
    assessmentAssignment: { create: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

import { tenantDb } from '@tims/db';
import { emailService } from '../../packages/api/src/services/email.service';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const CANDIDATE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const VACANCY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03';
const TYPE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a04';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { assessmentRouter } = await import('../../packages/api/src/routers/assessment');
  const callerFactory = createCallerFactory(router({ assessment: assessmentRouter }));
  return callerFactory({
    user: {
      id: 'staff-1',
      organizationId: ORG_ID,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'staff@example.com',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenantDb.assessmentType.findFirst).mockResolvedValue({ id: TYPE_ID } as never);
  vi.mocked(tenantDb.candidate.findFirst).mockResolvedValue({ id: CANDIDATE_ID } as never);
  vi.mocked(tenantDb.candidate.count).mockResolvedValue(1);
  vi.mocked(tenantDb.assessmentQuestion.count).mockResolvedValue(0);
  vi.mocked(tenantDb.organization.findFirst).mockResolvedValue({ slug: 'tims', name: 'TIMS International' } as never);
  vi.mocked(tenantDb.assessmentAssignment.findFirst).mockResolvedValue({
    id: 'assignment-1',
    expiresAt: null,
    candidate: { email: 'candidate@example.com', firstName: 'Ana' },
    assessmentType: { name: 'Cognitive Battery' },
  } as never);
  vi.mocked(tenantDb.assessmentAssignment.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe('assessment reminder delivery', () => {
  it('records reminderSentAt only after provider acceptance', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(true);
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: true,
      status: 'provider_accepted',
      reminderRecorded: true,
      to: 'candidate@example.com',
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledWith(expect.objectContaining({
      candidateEmail: 'candidate@example.com',
      assessmentUrl: expect.stringMatching(/\/careers\/tims\/dashboard$/),
    }));
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: TYPE_ID, organizationId: ORG_ID, status: { in: ['assigned', 'in_progress'] } },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(vi.mocked(emailService.sendAssessmentReminder).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.invocationCallOrder[0]);
  });

  it('reports provider delivery as unconfirmed without recording a reminder', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(false);
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: null,
      status: 'delivery_unconfirmed',
      reminderRecorded: false,
    });
    expect(tenantDb.assessmentAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('reports a transport exception as unconfirmed and never retries automatically', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockRejectedValue(new Error('transport timeout'));
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: null,
      status: 'delivery_unconfirmed',
      reminderRecorded: false,
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce();
    expect(tenantDb.assessmentAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('does not email an expired assignment', async () => {
    vi.mocked(tenantDb.assessmentAssignment.findFirst).mockResolvedValue({
      expiresAt: new Date('2020-01-01'),
      candidate: { email: 'candidate@example.com', firstName: 'Ana' },
      assessmentType: { name: 'Cognitive Battery' },
    } as never);
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).rejects.toMatchObject({
      code: 'CONFLICT', message: 'assignment_expired',
    });
    expect(emailService.sendAssessmentReminder).not.toHaveBeenCalled();
    expect(tenantDb.assessmentAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('does not mark a cancelled assignment reminded after an email race', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(true);
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockResolvedValue({ count: 0 } as never);
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: true,
      status: 'provider_accepted_record_unconfirmed',
      reminderRecorded: false,
    });
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['assigned', 'in_progress'] } }),
    }));
  });

  it('preserves provider acceptance when recording the reminder throws', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(true);
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockRejectedValue(new Error('database unavailable'));
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: true,
      status: 'provider_accepted_record_unconfirmed',
      reminderRecorded: false,
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce();
  });
});

describe('assessment assignment readiness', () => {
  it('refuses a single assignment with no active questions', async () => {
    const caller = await makeCaller();
    await expect(caller.assessment.assign({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, assessmentTypeId: TYPE_ID }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'assessment_has_no_questions' });
    expect(tenantDb.assessmentQuestion.count).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, assessmentTypeId: TYPE_ID, isActive: true },
    });
    expect(tenantDb.assessmentAssignment.create).not.toHaveBeenCalled();
  });

  it('refuses a bulk assignment with no active questions', async () => {
    const caller = await makeCaller();
    await expect(caller.assessment.bulkAssign({ candidateIds: [CANDIDATE_ID], vacancyId: VACANCY_ID, assessmentTypeId: TYPE_ID }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'assessment_has_no_questions' });
    expect(tenantDb.assessmentAssignment.createMany).not.toHaveBeenCalled();
  });

  it('creates an assignment when questions are available', async () => {
    vi.mocked(tenantDb.assessmentQuestion.count).mockResolvedValue(1);
    vi.mocked(tenantDb.assessmentAssignment.create).mockResolvedValue({ id: 'assignment-1' } as never);
    const caller = await makeCaller();
    await expect(caller.assessment.assign({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, assessmentTypeId: TYPE_ID }))
      .resolves.toMatchObject({ id: 'assignment-1' });
    expect(tenantDb.assessmentAssignment.create).toHaveBeenCalledOnce();
  });
});
