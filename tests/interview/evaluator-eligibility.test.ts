import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot call audit 2026-11-05: the evaluator picker offered Colaboradores (employee role: no interview grant).
// They got the invitation with the room link and then FORBIDDEN, because the room reads the interview
// (interview:read) and the scorecard is interview.submitScorecard (interview:create). The server now refuses
// such evaluators on schedule, addEvaluator and reschedule (services/interview-evaluator-eligibility.service.ts);
// the C# picker lists only people holding both permissions (AssignablePurposes.RuleFor(InterviewEvaluator)).

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INTERVIEW_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const VACANCY_ID = '44444444-4444-4444-8444-444444444444';
const RECRUITER_ID = '55555555-5555-4555-8555-555555555555';
const EMPLOYEE_ID = '77777777-7777-4777-8777-777777777777';
const COMMITTEE_ID = '88888888-8888-4888-8888-888888888888';
const CALLER_ID = '66666666-6666-4666-8666-666666666666';

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  userRoles: Array<{ role: { slug: string } }>;
};
const person = (id: string, firstName: string, slugs: string[], isActive = true): Person => ({
  id,
  firstName,
  lastName: 'Prueba',
  isActive,
  userRoles: slugs.map((slug) => ({ role: { slug } })),
});

// Grants per role, as seed-access-matrix.ts has them for these permissions (any scope counts).
const GRANTS: Record<string, string[]> = {
  hr_admin: ['interview:read', 'interview:create', 'interview:update'],
  recruiter: ['interview:read', 'interview:create', 'interview:update'],
  committee: ['interview:read', 'interview:create', 'interview:update'],
  employee: [],
  // Not MATRIX rows: custom shapes holding only one of the two, to pin the AND in both directions.
  hrbp: ['interview:read'],
  leader: ['interview:create'],
};

const m = vi.hoisted(() => ({
  people: [] as Array<{
    id: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    userRoles: Array<{ role: { slug: string } }>;
  }>,
  panel: [] as string[],
  userFindMany: vi.fn(),
  panelFindMany: vi.fn(),
  interviewCreate: vi.fn(),
  interviewFindFirst: vi.fn(),
  appFindFirst: vi.fn(),
  txUserFind: vi.fn(),
  txEvaluatorCreate: vi.fn(),
  txInterviewUpdateMany: vi.fn(),
  notify: vi.fn(),
  access: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  tenantDb: {
    user: { findMany: m.userFindMany },
    interviewEvaluator: { findMany: m.panelFindMany },
    interview: { create: m.interviewCreate, findFirst: m.interviewFindFirst },
    application: { findFirst: m.appFindFirst },
  },
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runTenantTransaction: async (_org: string, fn: (tx: unknown) => unknown) =>
    fn({
      user: { findFirst: m.txUserFind },
      interviewEvaluator: { create: m.txEvaluatorCreate },
      interview: { updateMany: m.txInterviewUpdateMany, findFirst: vi.fn(async () => ({ id: INTERVIEW_ID })) },
      interviewScorecard: { count: vi.fn(async () => 0) },
    }),
}));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: m.access,
  createAnchorLoader: vi.fn().mockReturnValue({}),
  scopeWhereFor: vi.fn(async () => ({})),
  assertScoped: vi.fn(async () => undefined),
}));
vi.mock('../../packages/api/src/services/interview-email.service', () => ({
  interviewEmailService: { notify: m.notify },
}));
vi.mock('../../packages/api/src/services/bell-notification.service', () => ({
  bellNotificationService: { panelAssigned: vi.fn(async () => undefined) },
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { isRecruitmentConsentWithdrawn: vi.fn(async () => false) },
}));

async function caller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { interviewCrudRouter } = await import('../../packages/api/src/routers/interview/crud');
  return createCallerFactory(router({ interview: interviewCrudRouter }))({
    user: {
      id: CALLER_ID,
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

const scheduleInput = (evaluatorIds: string[]) => ({
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
  type: 'video',
  scheduledAt: new Date('2026-11-12T16:00:00Z'),
  duration: 60,
  evaluatorIds,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://ats.example.test';
  m.people = [
    person(RECRUITER_ID, 'Rita', ['recruiter']),
    person(EMPLOYEE_ID, 'Eli', ['employee']),
    person(COMMITTEE_ID, 'Tomas', ['committee']),
  ];
  m.panel = [];
  m.access.mockImplementation(async (user: { roles: string[] }, module: string, action: string) => {
    const allowed = user.roles.some((role) => (GRANTS[role] ?? []).includes(`${module}:${action}`));
    return allowed ? { allowed: true, scope: 'organization', roles: user.roles } : { allowed: false };
  });
  m.userFindMany.mockImplementation(async (args: { where: { id: { in: string[] }; organizationId: string } }) =>
    args.where.organizationId === ORG_ID ? m.people.filter((p) => args.where.id.in.includes(p.id)) : [],
  );
  m.panelFindMany.mockImplementation(async () => m.panel.map((userId) => ({ userId })));
  m.appFindFirst.mockResolvedValue({ id: 'app-1' });
  m.interviewCreate.mockResolvedValue({ id: INTERVIEW_ID, candidateId: CANDIDATE_ID });
  m.interviewFindFirst.mockResolvedValue({
    id: INTERVIEW_ID,
    status: 'scheduled',
    type: 'video',
    duration: 60,
    meetingUrl: null,
    scheduledAt: new Date('2026-11-10T16:00:00Z'),
  });
  m.txUserFind.mockResolvedValue({ id: EMPLOYEE_ID });
  m.txEvaluatorCreate.mockResolvedValue({ id: 'ie-1' });
  m.txInterviewUpdateMany.mockResolvedValue({ count: 1 });
  m.notify.mockResolvedValue(undefined);
});

describe('canActAsEvaluator — open the room AND submit the scorecard', () => {
  const svc = () => import('../../packages/api/src/services/interview-evaluator-eligibility.service');
  const candidate = (slugs: string[], isActive = true) => ({
    id: RECRUITER_ID,
    firstName: 'A',
    lastName: 'B',
    isActive,
    roleSlugs: slugs,
  });

  it('a recruiter or committee member can act; an employee (Colaborador) cannot', async () => {
    const { canActAsEvaluator } = await svc();
    expect(await canActAsEvaluator(ORG_ID, candidate(['recruiter']))).toBe(true);
    expect(await canActAsEvaluator(ORG_ID, candidate(['committee']))).toBe(true);
    expect(await canActAsEvaluator(ORG_ID, candidate(['employee']))).toBe(false);
  });

  it('needs BOTH interview:read and interview:create, through any of their roles', async () => {
    const { canActAsEvaluator } = await svc();
    expect(await canActAsEvaluator(ORG_ID, candidate(['hrbp']))).toBe(false); // read only
    expect(await canActAsEvaluator(ORG_ID, candidate(['leader']))).toBe(false); // create only
    expect(await canActAsEvaluator(ORG_ID, candidate(['hrbp', 'leader']))).toBe(true); // one each
    expect(await canActAsEvaluator(ORG_ID, candidate(['employee', 'committee']))).toBe(true);
    const asked = m.access.mock.calls.map((c) => `${c[1]}:${c[2]}`);
    expect(asked).toEqual(expect.arrayContaining(['interview:read', 'interview:create']));
  });

  it('an inactive user or one with no staff role cannot act, without a permission lookup', async () => {
    const { canActAsEvaluator } = await svc();
    expect(await canActAsEvaluator(ORG_ID, candidate(['recruiter'], false))).toBe(false);
    expect(await canActAsEvaluator(ORG_ID, candidate(['candidate', 'external']))).toBe(false);
    expect(m.access).not.toHaveBeenCalled();
  });

  it('checks the evaluator as a non-platform-owner session of THIS organization', async () => {
    const { canActAsEvaluator } = await svc();
    await canActAsEvaluator(ORG_ID, candidate(['committee', 'candidate']));
    expect(m.access).toHaveBeenCalledWith(
      { id: RECRUITER_ID, organizationId: ORG_ID, roles: ['committee'], isPlatformOwner: false },
      'interview',
      'read',
    );
  });

  it('names who cannot act, in Spanish (tú), singular and plural', async () => {
    const { evaluatorsCannotActMessage } = await svc();
    const eli = { id: EMPLOYEE_ID, firstName: 'Eli', lastName: 'Prueba', isActive: true, roleSlugs: ['employee'] };
    const ana = { ...eli, id: COMMITTEE_ID, firstName: 'Ana' };
    expect(evaluatorsCannotActMessage([eli], 'schedule')).toBe(
      'Eli Prueba no puede abrir la sala de entrevista ni enviar el scorecard (usuario inactivo o sin acceso a entrevistas). Elige otro evaluador o pide a un administrador que le asigne un rol con acceso a entrevistas.',
    );
    expect(evaluatorsCannotActMessage([eli, ana], 'reschedule')).toMatch(
      /^No se puede reprogramar: Eli Prueba y Ana Prueba no pueden abrir la sala .* Quítalos del panel/,
    );
  });
});

describe('interview.schedule refuses evaluators who cannot act', () => {
  it('a Colaborador on the panel → BAD_REQUEST naming them, and nothing is written or emailed', async () => {
    await expect((await caller()).interview.schedule(scheduleInput([RECRUITER_ID, EMPLOYEE_ID]))).rejects.toMatchObject(
      {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Eli Prueba no puede abrir la sala de entrevista'),
      },
    );
    expect(m.interviewCreate).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('an id that is not a user of this organization is still NOT_FOUND', async () => {
    await expect(
      (await caller()).interview.schedule(scheduleInput([RECRUITER_ID, '99999999-9999-4999-8999-999999999999'])),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Evaluador no encontrado en esta organización' });
    expect(m.interviewCreate).not.toHaveBeenCalled();
  });

  it('a panel of people who can act is scheduled (duplicates checked once)', async () => {
    await (await caller()).interview.schedule(scheduleInput([RECRUITER_ID, COMMITTEE_ID, RECRUITER_ID]));
    expect(m.interviewCreate).toHaveBeenCalledTimes(1);
    expect(m.userFindMany.mock.calls[0]![0].where).toEqual({
      id: { in: [RECRUITER_ID, COMMITTEE_ID] },
      organizationId: ORG_ID,
    });
  });
});

describe('interview.addEvaluator refuses an evaluator who cannot act', () => {
  it('a Colaborador → BAD_REQUEST, no panel row', async () => {
    await expect(
      (await caller()).interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: EMPLOYEE_ID }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(m.txEvaluatorCreate).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('a committee member is added', async () => {
    m.txUserFind.mockResolvedValue({ id: COMMITTEE_ID });
    await expect(
      (await caller()).interview.addEvaluator({ interviewId: INTERVIEW_ID, userId: COMMITTEE_ID }),
    ).resolves.toEqual({ id: 'ie-1' });
  });
});

describe('interview.reschedule refuses while the panel holds someone who cannot act', () => {
  const input = { id: INTERVIEW_ID, scheduledAt: new Date('2026-11-13T16:00:00Z') };

  it('a Colaborador already on the panel → BAD_REQUEST, no write, no update email', async () => {
    m.panel = [RECRUITER_ID, EMPLOYEE_ID];
    await expect((await caller()).interview.reschedule(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/^No se puede reprogramar: Eli Prueba no puede abrir la sala/),
    });
    expect(m.panelFindMany.mock.calls[0]![0].where).toEqual({
      interviewId: INTERVIEW_ID,
      interview: { organizationId: ORG_ID },
    });
    expect(m.txInterviewUpdateMany).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('a panel of people who can act is rescheduled', async () => {
    m.panel = [RECRUITER_ID, COMMITTEE_ID];
    await (await caller()).interview.reschedule(input);
    expect(m.txInterviewUpdateMany).toHaveBeenCalledTimes(1);
  });
});
