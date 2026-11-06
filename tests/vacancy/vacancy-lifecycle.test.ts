import { describe, it, expect, vi, beforeEach } from 'vitest';

// A-08 / journeys-23 / spec-39 / B-10: vacancy.update (the "Editar" drawer), vacancy.freeze ("Congelar"),
// vacancy.resume ("Reanudar") and the narrow-scope creator rules on vacancy.create / vacancy.duplicate.
const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY = '44444444-4444-4444-8444-444444444444';
const TEAM = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '33333333-3333-4333-8333-333333333333';
const ME = 'user-1';

const db = vi.hoisted(() => ({
  vacancy: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  user: { findFirst: vi.fn() },
}));
const tx = vi.hoisted(() => ({
  // resume locks the vacancy row and counts converted offers first (the hire path's lock).
  $queryRaw: vi.fn(),
  offer: { count: vi.fn() },
  vacancy: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
  auditLog: { create: vi.fn() },
  jobProfile: { create: vi.fn() },
  pipelineStage: { createMany: vi.fn() },
}));
const runTenantTransaction = vi.hoisted(() =>
  vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
);
vi.mock('@tims/db', () => ({
  tenantDb: db,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction,
}));

// The caller's grant: scope per test, and whether vacancy:publish is held.
const grant = vi.hoisted(() => ({ scope: 'organization', publish: true, ledTeamIds: [] as string[] }));
const access = vi.hoisted(() => ({
  buildAccessForUser: vi.fn(async (_user: unknown, _module: string, action: string) =>
    action === 'publish' && !grant.publish
      ? { allowed: false }
      : { allowed: true, scope: grant.scope, roles: ['recruiter'] },
  ),
  createAnchorLoader: vi.fn(() => ({ ledTeamIds: async () => grant.ledTeamIds })),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: access.buildAccessForUser }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: access.createAnchorLoader }));
vi.mock('../../packages/api/src/access', () => access);

async function makeCaller() {
  const { createCallerFactory, router, mergeRouters } = await import('../../packages/api/src/trpc');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  const { vacancyLifecycleRouter } = await import('../../packages/api/src/routers/vacancy/lifecycle');
  return createCallerFactory(router({ vacancy: mergeRouters(vacancyCrudRouter, vacancyLifecycleRouter) }))({
    user: {
      id: ME,
      organizationId: ORG,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'r@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never);
}

const T1 = new Date('2026-10-01T15:00:00Z');
const T2 = new Date('2026-10-05T15:00:00Z');
function frozen(overrides: Record<string, unknown> = {}) {
  return { id: VACANCY, closedAt: null, channels: [], approvals: [], ...overrides };
}

const row = (status: string) => ({
  id: VACANCY,
  title: 'Analista',
  status,
  priority: 'medium',
  positions: 1,
  createdAt: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  grant.scope = 'organization';
  grant.publish = true;
  grant.ledTeamIds = [];
  tx.vacancy.updateMany.mockResolvedValue({ count: 1 });
  tx.vacancy.findFirstOrThrow.mockResolvedValue(row('published'));
  tx.$queryRaw.mockResolvedValue([{ positions: 1 }]);
  tx.offer.count.mockResolvedValue(0);
  db.vacancy.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: VACANCY,
    ...args.data,
  }));
  tx.vacancy.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: VACANCY,
    ...args.data,
  }));
  db.user.findFirst.mockResolvedValue({ id: OTHER_USER });
});

describe('vacancy.update (edit drawer)', () => {
  it('writes only while the vacancy is in an editable status, with an audit row naming the fields', async () => {
    const caller = await makeCaller();
    await caller.vacancy.update({
      id: VACANCY,
      title: 'Analista Sr',
      salary: { min: 1, max: 2, currency: 'CRC', period: 'monthly' },
    });

    expect(runTenantTransaction).toHaveBeenCalledWith(ORG, expect.any(Function));
    const where = tx.vacancy.updateMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ id: VACANCY, organizationId: ORG, deletedAt: null });
    expect(where.status.in).toEqual(['draft', 'approved', 'published', 'frozen']);
    expect(where.status.in).not.toContain('pending_approval');
    expect(where.status.in).not.toContain('closed');
    // Codex P1: a legacy frozen request keeps a pending chain; editing it would bypass the earlier approvers.
    expect(where.approvals).toEqual({ none: { status: 'pending' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        userId: ME,
        actorId: ME,
        action: 'vacancy_updated',
        entity: 'vacancy',
        entityId: VACANCY,
        metadata: { fields: ['salary', 'title'] },
      }),
    });
    // Field names only: the salary figures never reach the audit trail.
    expect(JSON.stringify(tx.auditLog.create.mock.calls[0])).not.toContain('CRC');
  });

  it('refuses a vacancy pending approval (or closed) with an actionable CONFLICT and no audit row', async () => {
    tx.vacancy.updateMany.mockResolvedValue({ count: 0 });
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, title: 'X' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/solicitud de aprobación en curso, retírala primero/),
    });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses an empty edit instead of writing an audit row for nothing', async () => {
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(tx.vacancy.updateMany).not.toHaveBeenCalled();
  });
});

describe('vacancy.freeze / vacancy.resume (A-08)', () => {
  it('freezes only a published vacancy', async () => {
    tx.vacancy.findFirstOrThrow.mockResolvedValue(row('frozen'));
    const caller = await makeCaller();
    await caller.vacancy.freeze({ id: VACANCY });
    expect(tx.vacancy.updateMany).toHaveBeenCalledWith({
      where: { id: VACANCY, organizationId: ORG, deletedAt: null, status: 'published' },
      data: { status: 'frozen' },
    });
    expect(tx.auditLog.create.mock.calls[0]![0].data.action).toBe('vacancy_frozen');

    tx.vacancy.updateMany.mockResolvedValue({ count: 0 });
    await expect(caller.vacancy.freeze({ id: VACANCY })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('resumes a frozen vacancy that was live back to published', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ channels: [{ id: 'ch-1' }] }));
    const caller = await makeCaller();
    const result = await caller.vacancy.resume({ id: VACANCY });
    expect(result.status).toBe('published');
    expect(tx.vacancy.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: VACANCY,
      organizationId: ORG,
      status: 'frozen',
    });
    expect(tx.vacancy.updateMany).toHaveBeenCalledWith({
      where: { id: VACANCY, organizationId: ORG, deletedAt: null, status: 'frozen' },
      data: { status: 'published' },
    });
    expect(tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'vacancy_resumed',
      metadata: { to: 'published' },
    });
  });

  // Codex P1: before this change freeze accepted ANY status, so a legacy frozen row may have been a draft
  // or a pending request. Resuming must restore that, never hand out an approval it never got.
  it('resumes a legacy frozen pending request to pending_approval, keeping its live chain', async () => {
    tx.vacancy.findFirst.mockResolvedValue(
      frozen({ approvals: [{ status: 'approved', createdAt: T1 }, { status: 'pending', createdAt: T1 }] }),
    );
    tx.vacancy.findFirstOrThrow.mockResolvedValue(row('pending_approval'));
    const caller = await makeCaller();
    await caller.vacancy.resume({ id: VACANCY });
    expect(tx.vacancy.updateMany.mock.calls[0]![0].data).toEqual({ status: 'pending_approval' });
  });

  it('resumes a legacy frozen draft (no approval request) to draft, not approved', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen());
    tx.vacancy.findFirstOrThrow.mockResolvedValue(row('draft'));
    const caller = await makeCaller();
    await caller.vacancy.resume({ id: VACANCY });
    expect(tx.vacancy.updateMany.mock.calls[0]![0].data).toEqual({ status: 'draft' });
  });

  it('resumes to approved only when the latest approval request was fully approved', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ approvals: [{ status: 'approved', createdAt: T1 }] }));
    tx.vacancy.findFirstOrThrow.mockResolvedValue(row('approved'));
    const caller = await makeCaller();
    await caller.vacancy.resume({ id: VACANCY });
    expect(tx.vacancy.updateMany.mock.calls[0]![0].data).toEqual({ status: 'approved' });
  });

  it('refuses a vacancy that was closed before it was frozen', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ closedAt: T1, channels: [{ id: 'ch-1' }] }));
    const caller = await makeCaller();
    await expect(caller.vacancy.resume({ id: VACANCY })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/no se puede reanudar/),
    });
    expect(tx.vacancy.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('answers CONFLICT when the vacancy is no longer frozen (closed by a hire meanwhile)', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ channels: [{ id: 'ch-1' }] }));
    tx.vacancy.updateMany.mockResolvedValue({ count: 0 });
    const caller = await makeCaller();
    await expect(caller.vacancy.resume({ id: VACANCY })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    tx.vacancy.findFirst.mockResolvedValue(null);
    await expect(caller.vacancy.resume({ id: VACANCY })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // Codex review of release/pilot-ux-wave2 (P2): a hire leaves a frozen vacancy frozen, so its positions can
  // fill meanwhile; resuming must not put a filled vacancy back on the careers portal.
  it('refuses to resume a vacancy whose hires already cover its positions, under the hire path lock', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ channels: [{ id: 'ch-1' }] }));
    tx.offer.count.mockResolvedValue(1);
    const caller = await makeCaller();
    await expect(caller.vacancy.resume({ id: VACANCY })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/ya está cubierta \(1 de 1 contratación\)/),
    });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toMatch(/FROM vacancies[\s\S]*FOR NO KEY UPDATE/);
    expect(values).toEqual([VACANCY, ORG]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.vacancy.findFirst.mock.invocationCallOrder[0]!);
    expect(tx.vacancy.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('resumes while positions remain open', async () => {
    tx.vacancy.findFirst.mockResolvedValue(frozen({ channels: [{ id: 'ch-1' }] }));
    tx.$queryRaw.mockResolvedValue([{ positions: 3 }]);
    tx.offer.count.mockResolvedValue(2);
    const caller = await makeCaller();
    await expect(caller.vacancy.resume({ id: VACANCY })).resolves.toMatchObject({ status: 'published' });
  });

  it('needs vacancy:publish, since resuming puts the vacancy back on the careers portal', async () => {
    grant.publish = false;
    const caller = await makeCaller();
    await expect(caller.vacancy.resume({ id: VACANCY })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(runTenantTransaction).not.toHaveBeenCalled();
  });
});

describe('vacancy.create / duplicate for a narrow-scope creator (B-10)', () => {
  const base = { title: 'Analista', positions: 1, priority: 'medium' as const };

  it('a team-scoped creator cannot skip approval and becomes the hiring manager of the request', async () => {
    grant.scope = 'team';
    const caller = await makeCaller();
    await caller.vacancy.create({ ...base, settings: { requireApproval: false } });
    const data = db.vacancy.create.mock.calls[0]![0].data;
    expect(data.status).toBe('draft');
    expect(data.settings).toMatchObject({ requireApproval: true, autoPublish: false });
    expect(data.assignedTo).toBe(ME);
  });

  it('keeps an explicit hiring manager chosen by a team-scoped creator', async () => {
    grant.scope = 'team';
    const caller = await makeCaller();
    await caller.vacancy.create({ ...base, assignedTo: OTHER_USER });
    expect(db.vacancy.create.mock.calls[0]![0].data.assignedTo).toBe(OTHER_USER);
  });

  it('an org-wide creator keeps the per-vacancy approval choice and no implicit assignee', async () => {
    const caller = await makeCaller();
    await caller.vacancy.create({ ...base, settings: { requireApproval: false } });
    const data = db.vacancy.create.mock.calls[0]![0].data;
    expect(data.status).toBe('approved');
    expect(data.assignedTo).toBeUndefined();
    expect(data.settings).toEqual({ requireApproval: false });
  });

  it('a duplicate made by a team-scoped caller stays in their scope', async () => {
    grant.scope = 'team';
    db.vacancy.findFirst.mockResolvedValue({
      title: 'Analista',
      description: null,
      organizationId: ORG,
      companyId: null,
      businessUnitId: null,
      teamId: null,
      positions: 1,
      priority: 'medium',
      salary: null,
      contractType: null,
      location: null,
      remotePolicy: null,
      settings: {},
      jobProfile: null,
      stages: [],
    });
    const caller = await makeCaller();
    await caller.vacancy.duplicate({ id: VACANCY });
    expect(tx.vacancy.create.mock.calls[0]![0].data).toMatchObject({ status: 'draft', createdBy: ME, assignedTo: ME });
  });
});

describe('resumeTargetFor (legacy frozen rows)', () => {
  it('derives the pre-freeze status from the LATEST approval request and fails closed', async () => {
    const { resumeTargetFor } = await import('../../packages/api/src/repositories/vacancy-lifecycle.repository');
    const base = { closedAt: null, hasPublishedChannel: false };
    // An older approved request, then a newer one that was rejected: a draft that needs approval again.
    expect(
      resumeTargetFor({ ...base, approvals: [{ status: 'approved', createdAt: T1 }, { status: 'rejected', createdAt: T2 }] }),
    ).toBe('draft');
    // Step 1 approved, then the request was withdrawn (step 2 cancelled): not an approved vacancy.
    expect(
      resumeTargetFor({ ...base, approvals: [{ status: 'approved', createdAt: T2 }, { status: 'cancelled', createdAt: T2 }] }),
    ).toBe('draft');
    expect(resumeTargetFor({ ...base, approvals: [{ status: 'approved', createdAt: T2 }, { status: 'approved', createdAt: T2 }] })).toBe(
      'approved',
    );
    expect(resumeTargetFor({ ...base, hasPublishedChannel: true, approvals: [] })).toBe('published');
    expect(resumeTargetFor({ closedAt: T1, hasPublishedChannel: true, approvals: [] })).toBeNull();
  });
});

describe('assigneeForCreator', () => {
  it('leaves a vacancy of a team the creator leads unassigned, and only team scope is affected', async () => {
    const { assigneeForCreator } = await import('../../packages/api/src/routers/vacancy/creator-scope');
    const team = {
      allowed: true as const,
      scope: 'team' as const,
      roles: ['leader'],
      anchors: { ledTeamIds: async () => [TEAM] },
    };
    expect(await assigneeForCreator(team as never, ME, TEAM, undefined)).toBeUndefined();
    expect(await assigneeForCreator(team as never, ME, 'other-team', undefined)).toBe(ME);
    expect(await assigneeForCreator(team as never, ME, null, OTHER_USER)).toBe(OTHER_USER);
    const unit = { ...team, scope: 'unit' as const };
    expect(await assigneeForCreator(unit as never, ME, null, undefined)).toBeUndefined();
    const org = { ...team, scope: 'organization' as const };
    expect(await assigneeForCreator(org as never, ME, null, undefined)).toBeUndefined();
  });
});
