import { describe, it, expect, vi } from 'vitest';

describe('external-validation.repository', () => {
  it('getValidationForSubmit selects id+status scoped to org', async () => {
    vi.resetModules();
    const findFirst = vi.fn().mockResolvedValue({ id: 'val-1', status: 'pending' });
    vi.doMock('@tims/db', () => ({ tenantDb: { preemploymentValidation: { findFirst, updateMany: vi.fn() } } }));
    const { getValidationForSubmit } = await import('../../packages/api/src/repositories/external-validation.repository');
    const row = await getValidationForSubmit('org-1', 'val-1');
    expect(row).toEqual({ id: 'val-1', status: 'pending' });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'val-1', organizationId: 'org-1' }, select: { id: true, status: true } });
    vi.doUnmock('@tims/db');
  });

  it('submitValidationResult issues an atomic pending-only updateMany with provenance', async () => {
    vi.resetModules();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.doMock('@tims/db', () => ({ tenantDb: { preemploymentValidation: { findFirst: vi.fn(), updateMany } } }));
    const { submitValidationResult } = await import('../../packages/api/src/repositories/external-validation.repository');
    const res = await submitValidationResult('org-1', 'val-1', 'key-1', { status: 'passed', result: { ok: true }, notes: 'done' });
    expect(res.count).toBe(1);
    expect(res.completedAt).toBeInstanceOf(Date);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'val-1', organizationId: 'org-1', status: 'pending' });
    expect(arg.data).toMatchObject({ status: 'passed', notes: 'done', completedByApiKeyId: 'key-1' });
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(arg.data.result).toEqual({ ok: true });
    expect(arg.data.completedById).toBeNull();
    vi.doUnmock('@tims/db');
  });
});
