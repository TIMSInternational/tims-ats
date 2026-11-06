import { beforeEach, describe, expect, it, vi } from 'vitest';

// C-11 wiring: the rejection email is opt-in (default OFF), queued after the response only when asked for,
// and staff are told when the candidate could not be notified. A-05: the actor is recorded.

const m = vi.hoisted(() => ({
  rejectCandidate: vi.fn(),
  notificationOutcome: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../../packages/api/src/services/pipeline.service', () => ({
  pipelineService: { rejectCandidate: m.rejectCandidate },
}));
vi.mock('../../packages/api/src/services/rejection-email.service', () => ({
  rejectionEmailService: { notificationOutcome: m.notificationOutcome, send: m.send },
}));
vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['recruiter'] })),
    assertScoped: vi.fn().mockResolvedValue(undefined),
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const APP = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

async function makeCaller(runAfterResponse: (task: () => Promise<void>) => void) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { pipelineRouter } = await import('../../packages/api/src/routers/pipeline');
  const callerFactory = createCallerFactory(router({ pipeline: pipelineRouter }));
  return callerFactory({
    user: {
      id: 'user-1',
      organizationId: ORG,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'r@example.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    runAfterResponse,
  } as never) as unknown as {
    pipeline: {
      rejectCandidate(input: {
        applicationId: string;
        reason: string;
        feedback?: string;
        notifyCandidate?: boolean;
      }): Promise<{ candidateNotification: string }>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rejectCandidate.mockResolvedValue({ id: APP, status: 'rejected', candidate: { id: 'c1' } });
  m.send.mockResolvedValue(true);
});

describe('pipeline.rejectCandidate notification', () => {
  it('sends nothing by default and records the actor', async () => {
    const after = vi.fn();
    const caller = await makeCaller(after);
    const result = await caller.pipeline.rejectCandidate({ applicationId: APP, reason: 'OTHER: Otro' });
    expect(result.candidateNotification).toBe('not_requested');
    expect(m.notificationOutcome).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(m.rejectCandidate).toHaveBeenCalledWith(
      ORG,
      { userId: 'user-1', actorId: 'user-1' },
      APP,
      'OTHER: Otro',
      undefined,
      false,
    );
  });

  it('queues the neutral email after the response when the recruiter opts in', async () => {
    m.notificationOutcome.mockResolvedValue('queued');
    const tasks: Array<() => Promise<void>> = [];
    const caller = await makeCaller((task) => tasks.push(task));
    const result = await caller.pipeline.rejectCandidate({ applicationId: APP, reason: 'OTHER: Otro', notifyCandidate: true });
    expect(result.candidateNotification).toBe('queued');
    expect(m.notificationOutcome).toHaveBeenCalledWith(ORG, 'c1');
    expect(m.send).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(m.send).toHaveBeenCalledWith(ORG, APP);
  });

  it('queues nothing and says so when the candidate revoked the authorization', async () => {
    m.notificationOutcome.mockResolvedValue('consent_withdrawn');
    const after = vi.fn();
    const caller = await makeCaller(after);
    const result = await caller.pipeline.rejectCandidate({ applicationId: APP, reason: 'OTHER: Otro', notifyCandidate: true });
    expect(result.candidateNotification).toBe('consent_withdrawn');
    expect(after).not.toHaveBeenCalled();
  });
});
