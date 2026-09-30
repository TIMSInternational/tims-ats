import { describe, it, expect, vi, beforeEach } from 'vitest';

// vacancy.create / vacancy.update must refuse companies, business units, teams and assignees that are not
// active rows of the caller's organization (the FK alone would accept another tenant's id — and list/detail
// would then return that row's name), a team that does not belong to the vacancy's effective business unit,
// and a unit that does not belong to the vacancy's effective company.
const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const BU = '11111111-1111-4111-8111-111111111111';
const OTHER_BU = '99999999-9999-4999-8999-999999999999';
const TEAM = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const VACANCY = '44444444-4444-4444-8444-444444444444';
const COMPANY = '55555555-5555-4555-8555-555555555555';
const OTHER_COMPANY = '66666666-6666-4666-8666-666666666666';
const OTHER_TEAM = '77777777-7777-4777-8777-777777777777';

const db = vi.hoisted(() => ({
  company: { findFirst: vi.fn() },
  businessUnit: { findFirst: vi.fn() },
  team: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  vacancy: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@tims/db', () => ({
  tenantDb: db,
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: vi.fn(),
}));
const access = vi.hoisted(() => ({
  buildAccessForUser: vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['recruiter'] })),
  createAnchorLoader: vi.fn().mockReturnValue(null),
  assertScoped: vi.fn().mockResolvedValue(undefined),
  scopeWhereFor: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../packages/api/src/access/build', () => ({ buildAccessForUser: access.buildAccessForUser }));
vi.mock('../../packages/api/src/access/anchors', () => ({ createAnchorLoader: access.createAnchorLoader }));
vi.mock('../../packages/api/src/access', () => access);

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { vacancyCrudRouter } = await import('../../packages/api/src/routers/vacancy/crud');
  return createCallerFactory(router({ vacancy: vacancyCrudRouter }))({
    user: {
      id: 'user-1',
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

const base = { title: 'Analista', positions: 1, priority: 'medium' as const, settings: { requireApproval: true } };

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: COMPANY });
  db.businessUnit.findFirst.mockResolvedValue({ id: BU, companyId: COMPANY });
  db.team.findFirst.mockResolvedValue({ businessUnitId: BU });
  db.user.findFirst.mockResolvedValue({ id: USER });
  db.vacancy.create.mockResolvedValue({ id: VACANCY });
  db.vacancy.update.mockResolvedValue({ id: VACANCY });
  db.vacancy.findFirst.mockResolvedValue({ companyId: null, businessUnitId: BU, teamId: null });
});

describe('vacancy org placement — tenant + consistency checks', () => {
  it('create: accepts in-org active unit, team of that unit, and active assignee (queries are org-filtered)', async () => {
    const caller = await makeCaller();
    await caller.vacancy.create({ ...base, businessUnitId: BU, teamId: TEAM, assignedTo: USER });
    expect(db.vacancy.create).toHaveBeenCalledTimes(1);
    expect(db.businessUnit.findFirst).toHaveBeenCalledWith({
      where: { id: BU, organizationId: ORG, isActive: true },
      select: { id: true, companyId: true },
    });
    expect(db.team.findFirst.mock.calls[0]![0].where).toMatchObject({ id: TEAM, organizationId: ORG, isActive: true });
    expect(db.user.findFirst.mock.calls[0]![0].where).toMatchObject({ id: USER, organizationId: ORG, isActive: true });
  });

  it('create: rejects a business unit outside the org (or inactive)', async () => {
    db.businessUnit.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.create({ ...base, businessUnitId: BU })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/unidad de negocio no existe/),
    });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it('create: rejects a team from another unit', async () => {
    db.team.findFirst.mockResolvedValue({ businessUnitId: OTHER_BU });
    const caller = await makeCaller();
    await expect(caller.vacancy.create({ ...base, businessUnitId: BU, teamId: TEAM })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/no pertenece a la unidad/),
    });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it('create: rejects an assignee who is not an active user of the org', async () => {
    db.user.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.create({ ...base, assignedTo: USER })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it("update: a team-only change is checked against the vacancy's CURRENT unit", async () => {
    db.vacancy.findFirst.mockResolvedValue({ companyId: null, businessUnitId: OTHER_BU, teamId: null });
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, teamId: TEAM })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/no pertenece a la unidad/),
    });
    expect(db.vacancy.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: VACANCY,
      organizationId: ORG,
      deletedAt: null,
    });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it('update: rejects a cross-tenant team id and leaves the vacancy untouched', async () => {
    db.team.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, businessUnitId: BU, teamId: TEAM })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it('update: clearing placement (null) needs no lookups', async () => {
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, businessUnitId: null, teamId: null, assignedTo: null });
    expect(db.businessUnit.findFirst).not.toHaveBeenCalled();
    expect(db.team.findFirst).not.toHaveBeenCalled();
    expect(db.vacancy.update).toHaveBeenCalledTimes(1);
  });

  // ── company (tenant leak through list/detail `company { name }`) ──────────────────────────────────────────
  it('create: rejects a company outside the org (or inactive) and never writes', async () => {
    db.company.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.create({ ...base, companyId: OTHER_COMPANY })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/empresa no existe/),
    });
    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER_COMPANY, organizationId: ORG, isActive: true },
      select: { id: true },
    });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it("create: rejects a unit that belongs to a different company than the vacancy's", async () => {
    db.businessUnit.findFirst.mockResolvedValue({ id: BU, companyId: OTHER_COMPANY });
    const caller = await makeCaller();
    await expect(caller.vacancy.create({ ...base, companyId: COMPANY, businessUnitId: BU })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/no pertenece a la empresa/),
    });
    expect(db.vacancy.create).not.toHaveBeenCalled();
  });

  it('create: accepts a company with a unit of that company', async () => {
    const caller = await makeCaller();
    await caller.vacancy.create({ ...base, companyId: COMPANY, businessUnitId: BU });
    expect(db.vacancy.create).toHaveBeenCalledTimes(1);
  });

  it('update: rejects a cross-tenant company id and leaves the vacancy untouched', async () => {
    db.company.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, companyId: OTHER_COMPANY })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it("update: a company-only change is checked against the vacancy's CURRENT unit", async () => {
    db.vacancy.findFirst.mockResolvedValue({ companyId: COMPANY, businessUnitId: BU, teamId: null });
    db.businessUnit.findFirst.mockResolvedValue({ companyId: COMPANY });
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, companyId: OTHER_COMPANY })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/no pertenece a la empresa/),
    });
    expect(db.businessUnit.findFirst.mock.calls.at(-1)![0].where).toMatchObject({ id: BU, organizationId: ORG });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  // ── unit-only change vs the CURRENT team ──────────────────────────────────────────────────────────────
  it("update: a unit-only change is rejected when the vacancy's CURRENT team belongs to another unit", async () => {
    db.vacancy.findFirst.mockResolvedValue({ companyId: null, businessUnitId: OTHER_BU, teamId: OTHER_TEAM });
    db.businessUnit.findFirst.mockResolvedValue({ id: BU, companyId: COMPANY });
    db.team.findFirst.mockResolvedValue({ businessUnitId: OTHER_BU }); // the current team stays in OTHER_BU
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, businessUnitId: BU })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/equipo actual de la vacante no pertenece/),
    });
    expect(db.team.findFirst.mock.calls[0]![0].where).toMatchObject({ id: OTHER_TEAM, organizationId: ORG });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it('update: a unit change together with clearing the team is accepted', async () => {
    db.vacancy.findFirst.mockResolvedValue({ companyId: null, businessUnitId: OTHER_BU, teamId: OTHER_TEAM });
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, businessUnitId: BU, teamId: null });
    expect(db.team.findFirst).not.toHaveBeenCalled();
    expect(db.vacancy.update).toHaveBeenCalledTimes(1);
  });

  it('update: a unit change whose current team belongs to the new unit is accepted', async () => {
    db.vacancy.findFirst.mockResolvedValue({ companyId: null, businessUnitId: OTHER_BU, teamId: TEAM });
    db.team.findFirst.mockResolvedValue({ businessUnitId: BU });
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, businessUnitId: BU });
    expect(db.vacancy.update).toHaveBeenCalledTimes(1);
  });

  // ── cross-tenant ids on update ───────────────────────────────────────────────────────────────────────
  it('update: rejects a cross-tenant business unit id and leaves the vacancy untouched', async () => {
    db.businessUnit.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, businessUnitId: OTHER_BU })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/unidad de negocio no existe/),
    });
    expect(db.businessUnit.findFirst.mock.calls[0]![0].where).toMatchObject({ id: OTHER_BU, organizationId: ORG });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it('update: rejects a cross-tenant assignee and leaves the vacancy untouched', async () => {
    db.user.findFirst.mockResolvedValue(null);
    const caller = await makeCaller();
    await expect(caller.vacancy.update({ id: VACANCY, assignedTo: USER })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/responsable asignado/),
    });
    expect(db.user.findFirst.mock.calls[0]![0].where).toMatchObject({ id: USER, organizationId: ORG, deletedAt: null });
    expect(db.vacancy.update).not.toHaveBeenCalled();
  });

  it('update: an edit that touches no anchor performs no placement lookups', async () => {
    const caller = await makeCaller();
    await caller.vacancy.update({ id: VACANCY, title: 'Nuevo titulo' });
    expect(db.vacancy.findFirst).not.toHaveBeenCalled();
    expect(db.vacancy.update).toHaveBeenCalledTimes(1);
  });
});
