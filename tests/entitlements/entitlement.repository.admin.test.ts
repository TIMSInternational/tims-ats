import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  orgEntitlement: { findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  planModule: { findMany: vi.fn() },
  plan: { findMany: vi.fn() },
  module: { findMany: vi.fn() },
  organization: { findFirst: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(mockDb) : Promise.all(arg as Promise<unknown>[])),
}));
vi.mock('@tims/db', () => ({ db: mockDb }));

import {
  getOrgEntitlementRows, upsertOrgEntitlement, applyPlanToOrg, organizationExists,
} from '../../packages/api/src/repositories/entitlement.repository';

beforeEach(() => { vi.clearAllMocks(); });

describe('getOrgEntitlementRows', () => {
  it('selects all rows including disabled (no enabled filter)', async () => {
    mockDb.orgEntitlement.findMany.mockResolvedValue([]);
    await getOrgEntitlementRows('org-1');
    const arg = mockDb.orgEntitlement.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: 'org-1' });
    expect(arg.select).toMatchObject({ moduleCode: true, enabled: true, source: true, limit: true, unitPrice: true });
  });
});

describe('upsertOrgEntitlement', () => {
  it('passes explicit null through to clear a field', async () => {
    await upsertOrgEntitlement('org-1', 'ai_screening', { limit: null });
    const arg = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(arg.where.organizationId_moduleCode).toEqual({ organizationId: 'org-1', moduleCode: 'ai_screening' });
    expect(arg.update).toHaveProperty('limit', null);
  });

  it('a create with no `enabled` in data defaults the create-branch to enabled: false (a create never implicitly grants access)', async () => {
    await upsertOrgEntitlement('org-1', 'ai_screening', { limit: 100 });
    const arg = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ enabled: false, limit: 100 });
  });

  it('a create with an explicit `enabled: true` in data grants access on create', async () => {
    await upsertOrgEntitlement('org-1', 'ai_voice_interview', { enabled: true, source: 'addon' });
    const arg = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ enabled: true, source: 'addon' });
  });

  it('update is a pass-through of data — no `enabled` key added when the caller omits it', async () => {
    await upsertOrgEntitlement('org-1', 'ai_screening', { limit: 100 });
    const arg = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('enabled');
    expect(arg.update).toEqual({ limit: 100 });
  });
});

describe('applyPlanToOrg', () => {
  it('upserts one plan-sourced row per plan module inside a transaction', async () => {
    mockDb.planModule.findMany.mockResolvedValue([
      { moduleCode: 'vacancies', limit: null }, { moduleCode: 'ai_screening', limit: 5000 },
    ]);
    const n = await applyPlanToOrg('org-1', 'ats-base');
    expect(n).toBe(2);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.orgEntitlement.upsert).toHaveBeenCalledTimes(2);
    const first = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(first.create).toMatchObject({ source: 'plan', enabled: true });
  });

  // FIX E: applying a plan is a true baseline reset — the admin UI's confirm
  // copy (entitlementsAdmin.applyPlanConfirm) says overrides reset to the
  // plan baseline, so any per-org unitPrice override must be cleared to null
  // (effective price falls back to the catalog default) on both branches.
  it('resets unitPrice to null on both the update and create branches (true baseline reset)', async () => {
    mockDb.planModule.findMany.mockResolvedValue([{ moduleCode: 'ai_screening', limit: 5000 }]);
    await applyPlanToOrg('org-1', 'ats-base');
    const call = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ enabled: true, source: 'plan', limit: 5000, unitPrice: null });
    expect(call.create).toMatchObject({ enabled: true, source: 'plan', limit: 5000, unitPrice: null });
  });
});

describe('organizationExists', () => {
  it('returns false when no org found', async () => {
    mockDb.organization.findFirst.mockResolvedValue(null);
    expect(await organizationExists('nope')).toBe(false);
  });
});
