import { describe, it, expect, vi, beforeEach } from 'vitest';

// "Competencias del puesto": vacancy.create writes the job profile in the same insert as the vacancy;
// vacancy.update replaces it under the same status compare-and-set + audit row as every other edit;
// vacancy.generateDescription's 'competencies' mode only suggests (stores nothing).
const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VACANCY = '44444444-4444-4444-8444-444444444444';
const ME = 'user-1';

const db = vi.hoisted(() => ({
  vacancy: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
  auditLog: { create: vi.fn() },
  user: { findFirst: vi.fn() },
}));
const tx = vi.hoisted(() => ({
  vacancy: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn() },
  auditLog: { create: vi.fn() },
  jobProfile: { upsert: vi.fn() },
  publicationChannel: { create: vi.fn() },
}));
const runTenantTransaction = vi.hoisted(() =>
  vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
);
vi.mock('@tims/db', () => ({
  tenantDb: db,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction,
}));

const access = vi.hoisted(() => ({
  buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['recruiter'] })),
  createAnchorLoader: vi.fn(() => ({ ledTeamIds: async () => [] })),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: access.buildAccessForUser }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: access.createAnchorLoader }));
vi.mock('../../packages/api/src/access', () => access);

const ai = vi.hoisted(() => ({
  generateVacancyDescription: vi.fn(),
  suggestVacancyCompetencies: vi.fn(),
  checkInclusiveLanguage: vi.fn(),
}));
vi.mock('@tims/ai', () => ai);

async function makeCaller() {
  const { createCallerFactory, router, mergeRouters } = await import('../../packages/api/src/trpc');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  const { vacancyLifecycleRouter } = await import('../../packages/api/src/routers/vacancy/lifecycle');
  const { vacancyAiRouter } = await import('../../packages/api/src/routers/vacancy/ai');
  return createCallerFactory(
    router({ vacancy: mergeRouters(vacancyCrudRouter, vacancyLifecycleRouter, vacancyAiRouter) }),
  )({
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

beforeEach(() => {
  vi.clearAllMocks();
  db.vacancy.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: VACANCY,
    ...args.data,
  }));
  tx.vacancy.updateMany.mockResolvedValue({ count: 1 });
  tx.vacancy.findFirstOrThrow.mockResolvedValue({
    id: VACANCY,
    title: 'Analista',
    status: 'draft',
    priority: 'medium',
    positions: 1,
    createdAt: new Date(),
  });
});

describe('vacancy.create with competencies', () => {
  it('creates the job profile in the same insert, in the stored shape (explicit scale), tenant-stamped', async () => {
    const caller = await makeCaller();
    await caller.vacancy.create({
      title: 'Analista',
      settings: { requireApproval: true },
      competencies: [
        { name: ' Liderazgo ', level: 4, code: 'builtin:leadership', description: 'Guía al equipo' },
        { name: 'SQL', level: 3 },
      ],
    });
    const data = db.vacancy.create.mock.calls[0]![0].data;
    expect(data.jobProfile).toEqual({
      create: {
        organizationId: ORG,
        competencies: [
          { name: 'Liderazgo', level: 4, scaleMax: 5, code: 'builtin:leadership', description: 'Guía al equipo' },
          { name: 'SQL', level: 3, scaleMax: 5 },
        ],
      },
    });
    // Not a vacancy column.
    expect(data).not.toHaveProperty('competencies');
  });

  it('creates no job profile without competencies (the scorecard keeps its generic set) — creation is never blocked', async () => {
    const caller = await makeCaller();
    await caller.vacancy.create({ title: 'Analista', settings: { requireApproval: true } });
    await caller.vacancy.create({ title: 'Analista 2', settings: { requireApproval: true }, competencies: [] });
    for (const call of db.vacancy.create.mock.calls) {
      expect(call[0].data).not.toHaveProperty('jobProfile');
      expect(call[0].data).not.toHaveProperty('competencies');
    }
  });

  it('refuses a repeated competency (case/accent-insensitive) before writing anything', async () => {
    const caller = await makeCaller();
    await expect(
      caller.vacancy.create({
        title: 'Analista',
        competencies: [
          { name: 'Comunicación', level: 3 },
          { name: 'comunicacion', level: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it('also writes the job profile on the auto-publish path (one transaction)', async () => {
    tx.vacancy.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: VACANCY,
      ...args.data,
    }));
    tx.vacancy.update.mockResolvedValue({ id: VACANCY, status: 'published' });
    const caller = await makeCaller();
    await caller.vacancy.create({
      title: 'Analista',
      settings: { autoPublish: true },
      competencies: [{ name: 'SQL', level: 3 }],
    });
    expect(tx.vacancy.create.mock.calls[0]![0].data.jobProfile.create.competencies).toEqual([
      { name: 'SQL', level: 3, scaleMax: 5 },
    ]);
  });
});

describe('vacancy.update with competencies (edit drawer)', () => {
  it('replaces them under the same status compare-and-set and names them in the same audit row', async () => {
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, competencies: [{ name: 'SQL', level: 4, scaleMax: 4 }] });

    const cas = tx.vacancy.updateMany.mock.calls[0]![0];
    expect(cas.where).toMatchObject({
      id: VACANCY,
      organizationId: ORG,
      status: { in: ['draft', 'approved', 'published', 'frozen'] },
    });
    // A competencies-only edit still writes the row, so the status check is a real compare-and-set.
    expect(cas.data.updatedAt).toBeInstanceOf(Date);
    expect(tx.jobProfile.upsert).toHaveBeenCalledWith({
      where: { vacancyId: VACANCY },
      create: { organizationId: ORG, vacancyId: VACANCY, competencies: [{ name: 'SQL', level: 4, scaleMax: 4 }] },
      update: { competencies: [{ name: 'SQL', level: 4, scaleMax: 4 }] },
      select: { id: true },
    });
    expect(tx.auditLog.create.mock.calls[0]![0].data.metadata).toEqual({ fields: ['competencies'] });
    // Field names only: never the rubric itself.
    expect(JSON.stringify(tx.auditLog.create.mock.calls[0])).not.toContain('SQL');
    // One transaction for both writes.
    expect(runTenantTransaction).toHaveBeenCalledTimes(1);
  });

  it('writes nothing to the job profile when the vacancy is not editable (pending approval, closed)', async () => {
    tx.vacancy.updateMany.mockResolvedValue({ count: 0 });
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, competencies: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.jobProfile.upsert).not.toHaveBeenCalled();
  });

  it('leaves the job profile alone on an edit without competencies', async () => {
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, title: 'Analista Sr' });
    expect(tx.jobProfile.upsert).not.toHaveBeenCalled();
    expect(tx.vacancy.updateMany.mock.calls[0]![0].data).not.toHaveProperty('updatedAt');
  });
});

describe('vacancy.generateDescription modes', () => {
  it("'competencies' only suggests, from the title and the description written so far", async () => {
    ai.suggestVacancyCompetencies.mockResolvedValue({
      competencies: [{ name: 'SQL', description: 'd', level: 3 }],
      model: 'haiku',
      tokensUsed: 9,
    });
    const caller = await makeCaller();
    const out = await caller.vacancy.generateDescription({
      title: 'Analista',
      mode: 'competencies',
      description: 'Reportes',
    });
    expect(ai.suggestVacancyCompetencies).toHaveBeenCalledWith(ORG, 'Analista', 'Reportes');
    expect(ai.generateVacancyDescription).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'competencies', competencies: [{ name: 'SQL' }] });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it('defaults to the description variants (unchanged callers)', async () => {
    ai.generateVacancyDescription.mockResolvedValue({
      formal: {},
      social: {},
      whatsapp: {},
      competencies: [],
      model: 'haiku',
      tokensUsed: 1,
    });
    const caller = await makeCaller();
    const out = await caller.vacancy.generateDescription({ title: 'Analista' });
    expect(ai.generateVacancyDescription).toHaveBeenCalledWith(ORG, 'Analista', undefined);
    expect(out.kind).toBe('variants');
  });
});
