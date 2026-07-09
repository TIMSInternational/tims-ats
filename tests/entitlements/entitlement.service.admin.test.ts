import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (vitest hoists vi.mock calls).
// Pure unit test: repository + cache are mocked, no live DB.
// invalidateEntitlementCache lives in the SAME service file as the functions
// under test, so it can't be vi.mock'd as a separate module — assert its
// side-effect instead (cacheInvalidatePrefix called with the org-scoped key).
// ---------------------------------------------------------------------------
vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  listModules: vi.fn(),
  getOrgEntitlementRows: vi.fn(),
  upsertOrgEntitlement: vi.fn().mockResolvedValue(undefined),
  applyPlanToOrg: vi.fn().mockResolvedValue(2),
  listPlans: vi.fn(),
}));
vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidatePrefix: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../packages/api/src/repositories/entitlement.repository';
import { cacheInvalidatePrefix } from '../../packages/api/src/lib/cache';
import {
  getOrgEntitlementsAdmin,
  setOrgEntitlement,
  assignPlan,
  listPlansForAdmin,
  listModulesForAdmin,
} from '../../packages/api/src/services/entitlement.service';

const mockCacheInvalidatePrefix = vi.mocked(cacheInvalidatePrefix);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrgEntitlementsAdmin', () => {
  it('merges catalog with org rows; catalog default fills missing price', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'ai_screening', name: 'Filtro', kind: 'core', metered: true, unit: 'screenings', defaultUnitPrice: 0.5 },
      { code: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes', defaultUnitPrice: 0.15 },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([
      { moduleCode: 'ai_screening', enabled: true, source: 'plan', limit: 5000, unitPrice: null },
    ] as never);

    const out = await getOrgEntitlementsAdmin('org-1');

    expect(out).toHaveLength(2);
    const screening = out.find((m) => m.moduleCode === 'ai_screening')!;
    // Org has a row for ai_screening, but that row's unitPrice is null (no
    // per-org override) — the raw `unitPrice` must stay null even though a
    // row exists, while `effectiveUnitPrice` falls back to the catalog default.
    expect(screening).toMatchObject({ enabled: true, source: 'plan', limit: 5000, unitPrice: null, effectiveUnitPrice: 0.5 });
    const voice = out.find((m) => m.moduleCode === 'ai_voice_interview')!;
    // No org row at all for ai_voice_interview — raw unitPrice is also null.
    expect(voice).toMatchObject({ enabled: false, source: null, limit: null, unitPrice: null, effectiveUnitPrice: 0.15 });
  });

  it('an org override unitPrice wins over the catalog default, and is exposed raw for editing', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'ai_screening', name: 'Filtro', kind: 'core', metered: true, unit: 'screenings', defaultUnitPrice: 0.5 },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([
      { moduleCode: 'ai_screening', enabled: true, source: 'plan', limit: 5000, unitPrice: 0.35 },
    ] as never);

    const out = await getOrgEntitlementsAdmin('org-1');

    // Raw `unitPrice` is the actual override (what the admin UI should edit);
    // `effectiveUnitPrice` is the merged value used for display/billing hints.
    expect(out.find((m) => m.moduleCode === 'ai_screening')).toMatchObject({ unitPrice: 0.35, effectiveUnitPrice: 0.35 });
  });
});

describe('setOrgEntitlement', () => {
  it('enabling an addon with no existing row sets source addon, then invalidates cache', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes', defaultUnitPrice: 0.15 },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([] as never);

    await setOrgEntitlement('org-1', 'ai_voice_interview', { enabled: true });

    expect(vi.mocked(repo.upsertOrgEntitlement)).toHaveBeenCalledWith(
      'org-1',
      'ai_voice_interview',
      expect.objectContaining({ enabled: true, source: 'addon' }),
    );
    expect(mockCacheInvalidatePrefix).toHaveBeenCalledWith('tims:entitlements:org-1');
  });

  it('enabling a non-addon module with no existing row sets source override', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'vacancies', name: 'Vacantes', kind: 'core', metered: false, unit: null, defaultUnitPrice: null },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([] as never);

    await setOrgEntitlement('org-1', 'vacancies', { enabled: true });

    expect(vi.mocked(repo.upsertOrgEntitlement)).toHaveBeenCalledWith(
      'org-1',
      'vacancies',
      expect.objectContaining({ enabled: true, source: 'override' }),
    );
  });

  it('a limit-only patch does not set source (preserves existing)', async () => {
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([
      { moduleCode: 'ai_screening', enabled: true, source: 'plan', limit: 5000, unitPrice: null },
    ] as never);

    await setOrgEntitlement('org-1', 'ai_screening', { limit: 10000 });

    const call = vi.mocked(repo.upsertOrgEntitlement).mock.calls[0][2];
    expect(call).not.toHaveProperty('source');
    expect(call).toMatchObject({ limit: 10000 });
    expect(repo.listModules).not.toHaveBeenCalled();
    expect(mockCacheInvalidatePrefix).toHaveBeenCalledWith('tims:entitlements:org-1');
  });

  it('a limit-only patch on a module with NO existing row does not implicitly grant access (sends no `enabled` key — the repository create-branch defaults to false)', async () => {
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([] as never);

    await setOrgEntitlement('org-1', 'ai_screening', { limit: 100 });

    const call = vi.mocked(repo.upsertOrgEntitlement).mock.calls[0][2];
    expect(call).not.toHaveProperty('enabled');
    expect(call).toMatchObject({ limit: 100 });
  });

  it('a unitPrice-only patch on a module WITH an existing enabled row preserves enabled (does not send the key)', async () => {
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([
      { moduleCode: 'ai_screening', enabled: true, source: 'plan', limit: 5000, unitPrice: null },
    ] as never);

    await setOrgEntitlement('org-1', 'ai_screening', { unitPrice: 0.2 });

    const call = vi.mocked(repo.upsertOrgEntitlement).mock.calls[0][2];
    expect(call).not.toHaveProperty('enabled');
    expect(call).toMatchObject({ unitPrice: 0.2 });
  });
});

describe('assignPlan', () => {
  it('applies the plan then invalidates cache, returning the applied count', async () => {
    vi.mocked(repo.applyPlanToOrg).mockResolvedValue(2);

    const result = await assignPlan('org-1', 'ats-base');

    expect(repo.applyPlanToOrg).toHaveBeenCalledWith('org-1', 'ats-base');
    expect(result).toEqual({ applied: 2 });
    expect(mockCacheInvalidatePrefix).toHaveBeenCalledWith('tims:entitlements:org-1');
  });
});

describe('catalog admin passthroughs', () => {
  it('listPlansForAdmin delegates to the repository listPlans', async () => {
    const plans = [{ code: 'ats-base', name: 'ATS Base', active: true }];
    vi.mocked(repo.listPlans).mockResolvedValue(plans as never);

    expect(await listPlansForAdmin()).toEqual(plans);
    expect(repo.listPlans).toHaveBeenCalledTimes(1);
  });

  it('listModulesForAdmin delegates to the repository listModules', async () => {
    const modules = [
      { code: 'ai_screening', name: 'Filtro', kind: 'core', metered: true, unit: 'screenings', defaultUnitPrice: 0.5 },
    ];
    vi.mocked(repo.listModules).mockResolvedValue(modules as never);

    expect(await listModulesForAdmin()).toEqual(modules);
    expect(repo.listModules).toHaveBeenCalledTimes(1);
  });
});
