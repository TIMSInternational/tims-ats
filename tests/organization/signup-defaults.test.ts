import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionOrgDefaults, provisionOrgEntitlements } from '../../packages/api/src/services/org-provisioning';
import { ATS_BASE_MODULES, MODULES } from '../../packages/db/prisma/seed-entitlements';

// ---------------------------------------------------------------------------
// Both org-creation transactions (self-serve signup in
// apps/web/app/auth/callback/route.ts, platform-owner provisioning in
// packages/api/src/routers/platform/organizations.ts) call these two
// functions with the SAME `tx` used to create the Organization row. Mirrors
// tests/entitlements/provision-invu.test.ts's mock-`tx` approach (no real DB).
// ---------------------------------------------------------------------------

type CreateArgs = { data: Record<string, unknown> };

function createMockTx() {
  return {
    company: {
      create: vi.fn().mockResolvedValue({ id: 'company-1' }),
    },
    businessUnit: {
      create: vi.fn().mockResolvedValue({ id: 'bu-1' }),
    },
    team: {
      create: vi.fn().mockResolvedValue({ id: 'team-1' }),
    },
    planModule: {
      findMany: vi.fn().mockResolvedValue(
        ATS_BASE_MODULES.map((moduleCode) => ({ planCode: 'ats-base', moduleCode, limit: null })),
      ),
    },
    orgEntitlement: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('provisionOrgDefaults', () => {
  let tx: MockTx;

  beforeEach(() => {
    tx = createMockTx();
  });

  it('creates a Company with country defaulted to CO and the given name', async () => {
    await provisionOrgDefaults(tx as never, ORG_ID, 'Acme Corp');

    expect(tx.company.create).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, name: 'Acme Corp', country: 'CO' },
      select: { id: true },
    });
  });

  it('creates a BusinessUnit scoped to the just-created Company', async () => {
    await provisionOrgDefaults(tx as never, ORG_ID, 'Acme Corp');

    const args = tx.businessUnit.create.mock.calls[0][0] as CreateArgs;
    expect(args.data).toMatchObject({ organizationId: ORG_ID, companyId: 'company-1', name: 'General' });
  });

  it('creates a Team scoped to the just-created BusinessUnit', async () => {
    await provisionOrgDefaults(tx as never, ORG_ID, 'Acme Corp');

    const args = tx.team.create.mock.calls[0][0] as CreateArgs;
    expect(args.data).toMatchObject({ organizationId: ORG_ID, businessUnitId: 'bu-1', name: 'Equipo General' });
  });

  it('returns the ids of all 3 created records', async () => {
    const result = await provisionOrgDefaults(tx as never, ORG_ID, 'Acme Corp');

    expect(result).toEqual({ companyId: 'company-1', businessUnitId: 'bu-1', teamId: 'team-1' });
  });
});

describe('provisionOrgEntitlements', () => {
  let tx: MockTx;

  beforeEach(() => {
    tx = createMockTx();
  });

  it('queries the ats-base plan modules', async () => {
    await provisionOrgEntitlements(tx as never, ORG_ID);

    expect(tx.planModule.findMany).toHaveBeenCalledWith({
      where: { planCode: 'ats-base' },
      select: { moduleCode: true, limit: true },
    });
  });

  it('creates one OrgEntitlement per returned plan module, enabled with source "plan"', async () => {
    await provisionOrgEntitlements(tx as never, ORG_ID);

    expect(tx.orgEntitlement.create).toHaveBeenCalledTimes(ATS_BASE_MODULES.length);
    for (const moduleCode of ATS_BASE_MODULES) {
      expect(tx.orgEntitlement.create).toHaveBeenCalledWith({
        data: { organizationId: ORG_ID, moduleCode, enabled: true, source: 'plan', limit: null },
      });
    }
  });

  it('never grants an addon-kind module (e.g. ai_voice_interview)', async () => {
    await provisionOrgEntitlements(tx as never, ORG_ID);

    const addonModules = MODULES.filter((m) => m.kind === 'addon').map((m) => m.code);
    expect(addonModules).toContain('ai_voice_interview');

    const grantedModuleCodes = tx.orgEntitlement.create.mock.calls.map(
      (call) => (call[0] as { data: { moduleCode: string } }).data.moduleCode,
    );
    for (const addonModuleCode of addonModules) {
      expect(grantedModuleCodes).not.toContain(addonModuleCode);
    }
  });
});
