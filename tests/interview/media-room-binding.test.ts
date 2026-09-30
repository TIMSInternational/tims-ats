import { beforeEach, describe, expect, it, vi } from 'vitest';

// Staff Daily tokens (owner on createVideoRoom) are minted only for the interview's OWN room, and no
// media procedure returns the candidate join-token columns.

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const INTERVIEW_ID = '1234abcd-0000-4000-8000-000000000001';
const USER_ID = '66666666-6666-6666-6666-666666666666';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  findUser: vi.fn(),
  createRoom: vi.fn(),
  createMeetingToken: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    interview: { findFirst: m.findFirst, update: m.update, findMany: m.findMany },
    user: { findUnique: m.findUser },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: vi.fn(),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
  assertScoped: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/api/src/services/video.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/api/src/services/video.service')>();
  return {
    ...actual,
    videoService: { createRoom: m.createRoom, createMeetingToken: m.createMeetingToken, isConfigured: () => true },
  };
});

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { interviewMediaRouter } = await import('../../packages/api/src/routers/interview/media');
  return createCallerFactory(router({ interview: interviewMediaRouter }))({
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@acme.test',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const FULL = 'tims-1234abcd000040008000000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  m.findUser.mockResolvedValue({ firstName: 'Eva', lastName: 'Lu' });
  m.createMeetingToken.mockResolvedValue('staff.token');
  m.createRoom.mockResolvedValue({ url: `https://tims.daily.co/${FULL}`, roomName: FULL });
  m.update.mockResolvedValue({ id: INTERVIEW_ID });
  m.findMany.mockResolvedValue([]);
});

describe('interview media room binding', () => {
  it.each([`https://tims.daily.co/${FULL}`, 'https://tims.daily.co/tims-1234abcd'])(
    'mints tokens for the interview own stored room %s',
    async (meetingUrl) => {
      m.findFirst.mockResolvedValue({ id: INTERVIEW_ID, meetingUrl });
      const api = await caller();
      await expect(api.interview.createVideoRoom({ interviewId: INTERVIEW_ID })).resolves.toMatchObject({
        token: 'staff.token',
      });
      await expect(api.interview.getVideoToken({ interviewId: INTERVIEW_ID })).resolves.toMatchObject({
        token: 'staff.token',
      });
    },
  );

  it.each([
    'https://tims.daily.co/tims-1234abcd000040008000000000000002', // another interview's room
    'https://tims.daily.co/tims-99999999',
    'https://zoom.us/j/123',
  ])('never mints a Daily token for a stored meetingUrl that is not the own room: %s', async (meetingUrl) => {
    m.findFirst.mockResolvedValue({ id: INTERVIEW_ID, meetingUrl });
    const api = await caller();
    await expect(api.interview.createVideoRoom({ interviewId: INTERVIEW_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(api.interview.getVideoToken({ interviewId: INTERVIEW_ID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(m.createMeetingToken).not.toHaveBeenCalled();
  });

  it('creates the room named from the full interview id when none is stored', async () => {
    m.findFirst.mockResolvedValue({ id: INTERVIEW_ID, meetingUrl: null });
    await (await caller()).interview.createVideoRoom({ interviewId: INTERVIEW_ID });
    expect(m.createRoom).toHaveBeenCalledWith(INTERVIEW_ID);
    expect(m.createMeetingToken).toHaveBeenCalledWith(FULL, 'Eva Lu', true);
  });

  it('saveTranscript and listToday never return the join-token columns', async () => {
    const api = await caller();
    await api.interview.saveTranscript({ interviewId: INTERVIEW_ID, transcriptUrl: 'https://files.example/t.txt' });
    await api.interview.listToday();
    const omit = { candidateJoinTokenHash: true, candidateJoinTokenExpiresAt: true };
    expect(m.update.mock.calls[0][0].omit).toEqual(omit);
    expect(m.findMany.mock.calls[0][0].omit).toEqual(omit);
  });
});
