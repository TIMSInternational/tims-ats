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
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenNthCalledWith(1, {
      where: { AND: [
        { id: TYPE_ID, organizationId: ORG_ID, status: { in: ['assigned', 'in_progress'] } },
        expect.any(Object),
        { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
        { OR: [{ reminderAttemptedAt: null }, { reminderAttemptedAt: { lte: expect.any(Date) } }] },
      ] },
      data: { reminderAttemptedAt: expect.any(Date) },
    });
    const attemptedAt = vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.calls[0]![0].data.reminderAttemptedAt;
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: TYPE_ID, organizationId: ORG_ID, status: { in: ['assigned', 'in_progress'] }, reminderAttemptedAt: attemptedAt },
      data: { reminderSentAt: expect.any(Date) },
    });
    const writes = vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.invocationCallOrder;
    const send = vi.mocked(emailService.sendAssessmentReminder).mock.invocationCallOrder[0]!;
    expect(writes[0]).toBeLessThan(send);
    expect(send).toBeLessThan(writes[1]);
  });

  it('reports provider delivery as unconfirmed without recording a reminder', async () => {
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(false);
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: null,
      status: 'delivery_unconfirmed',
      reminderRecorded: false,
    });
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenCalledOnce();
    expect(vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.calls[0]![0].data)
      .toEqual({ reminderAttemptedAt: expect.any(Date) });
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
    expect(tenantDb.assessmentAssignment.updateMany).toHaveBeenCalledOnce();
    expect(vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.calls[0]![0].data)
      .toEqual({ reminderAttemptedAt: expect.any(Date) });
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
    vi.mocked(tenantDb.assessmentAssignment.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
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
    vi.mocked(tenantDb.assessmentAssignment.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: true,
      status: 'provider_accepted_record_unconfirmed',
      reminderRecorded: false,
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce();
  });

  it('allows only one concurrent send for the same assignment', async () => {
    let claimed = false;
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockImplementation((args) => {
      if ('reminderAttemptedAt' in args.data) {
        if (claimed) return { count: 0 } as never;
        claimed = true;
      }
      return { count: 1 } as never;
    });
    let finishSend: (accepted: boolean) => void = () => undefined;
    vi.mocked(emailService.sendAssessmentReminder).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { finishSend = resolve; }),
    );

    const caller = await makeCaller();
    const first = caller.assessment.resend({ assignmentId: TYPE_ID });
    await vi.waitFor(() => expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce());
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).rejects.toMatchObject({
      code: 'CONFLICT', message: 'reminder_unavailable',
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce();
    finishSend(true);
    await expect(first).resolves.toMatchObject({ status: 'provider_accepted' });
  });

  it('keeps an uncertain send in cooldown without marking it as sent', async () => {
    let claimed = false;
    vi.mocked(tenantDb.assessmentAssignment.updateMany).mockImplementation((args) => {
      if ('reminderAttemptedAt' in args.data) {
        if (claimed) return { count: 0 } as never;
        claimed = true;
      }
      return { count: 1 } as never;
    });
    vi.mocked(emailService.sendAssessmentReminder).mockResolvedValue(false);

    const caller = await makeCaller();
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).resolves.toMatchObject({
      sent: null, reminderRecorded: false,
    });
    await expect(caller.assessment.resend({ assignmentId: TYPE_ID })).rejects.toMatchObject({
      code: 'CONFLICT', message: 'reminder_unavailable',
    });
    expect(emailService.sendAssessmentReminder).toHaveBeenCalledOnce();
    expect(vi.mocked(tenantDb.assessmentAssignment.updateMany).mock.calls.every(([args]) =>
      'reminderAttemptedAt' in args.data)).toBe(true);
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
