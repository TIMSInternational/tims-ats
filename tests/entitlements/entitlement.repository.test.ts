import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock-based (no real DB). Verifies findEnabledEntitlements resolves the
// EFFECTIVE unitPrice — the org-row override when set, else the module
// catalog's defaultUnitPrice — instead of returning the org row's raw
// (frequently null) unitPrice as-is.
// ---------------------------------------------------------------------------

vi.mock('@tims/db', () => ({
  db: {
    orgEntitlement: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@tims/db';
import { findEnabledEntitlements } from '../../packages/api/src/repositories/entitlement.repository';

const mockFindMany = vi.mocked(db.orgEntitlement.findMany);

describe('entitlement.repository — findEnabledEntitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves unitPrice to the module catalog default when the org row unitPrice is null', async () => {
    mockFindMany.mockResolvedValue([
      { moduleCode: 'ai_screening', limit: 5000, unitPrice: null, module: { defaultUnitPrice: 0.5 } },
    ] as never);

    const result = await findEnabledEntitlements('org1');

    expect(result).toEqual([{ moduleCode: 'ai_screening', limit: 5000, unitPrice: 0.5 }]);
  });

  it('keeps the explicit org unitPrice override when set (does not fall back to the catalog default)', async () => {
    mockFindMany.mockResolvedValue([
      { moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.2, module: { defaultUnitPrice: 0.15 } },
    ] as never);

    const result = await findEnabledEntitlements('org1');

    expect(result).toEqual([{ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.2 }]);
  });

  it('returns null unitPrice when both the org override and the catalog default are null', async () => {
    mockFindMany.mockResolvedValue([
      { moduleCode: 'vacancies', limit: null, unitPrice: null, module: { defaultUnitPrice: null } },
    ] as never);

    const result = await findEnabledEntitlements('org1');

    expect(result).toEqual([{ moduleCode: 'vacancies', limit: null, unitPrice: null }]);
  });

  it('selects module: { select: { defaultUnitPrice: true } } — no full-record module return', async () => {
    mockFindMany.mockResolvedValue([]);
    await findEnabledEntitlements('org1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org1', enabled: true },
        select: expect.objectContaining({
          moduleCode: true,
          limit: true,
          unitPrice: true,
          module: { select: { defaultUnitPrice: true } },
        }),
      }),
    );
  });

  it('the flattened return shape only exposes {moduleCode, limit, unitPrice} — the cache shape is unchanged', async () => {
    mockFindMany.mockResolvedValue([
      { moduleCode: 'ai_screening', limit: 5000, unitPrice: null, module: { defaultUnitPrice: 0.5 } },
    ] as never);

    const result = await findEnabledEntitlements('org1');

    expect(Object.keys(result[0]).sort()).toEqual(['limit', 'moduleCode', 'unitPrice']);
  });
});
