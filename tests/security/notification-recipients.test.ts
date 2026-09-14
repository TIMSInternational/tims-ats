import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn(), bulk: vi.fn(), transaction: vi.fn() }));
vi.mock('@tims/db', () => ({ runTenantTransaction: mocks.transaction }));
import { notificationService } from '../../packages/api/src/services/notification.service';

const org = '11111111-1111-1111-1111-111111111111';
const member = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';
const content = { type: 'info', title: 'Notice' };
beforeEach(() => {
  vi.resetAllMocks();
  const tx = { $queryRaw: mocks.query, notification: { create: mocks.create, createMany: mocks.bulk } };
  mocks.transaction.mockImplementation((_org: string, run: (value: typeof tx) => Promise<unknown>) => run(tx));
  mocks.query.mockResolvedValue([{ id: member }]);
});

describe('notification recipient security', () => {
  it('checks and locks active undeleted organization members before insertion in the same transaction', async () => {
    mocks.create.mockResolvedValue({ id: 'created' });
    await expect(notificationService.create(org, member, content)).resolves.toEqual({ id: 'created' });
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toMatch(/organization_id = .*::uuid/);
    expect(sql.sql).toContain('is_active = true AND deleted_at IS NULL ORDER BY id FOR SHARE');
    expect(sql.values).toEqual([org, member]);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: { ...content, userId: member, organizationId: org } }));
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });
  it('rejects an unavailable recipient without writing', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(notificationService.create(org, other, content)).rejects.toThrow('Invalid notification recipients');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects the whole mixed batch before writing any valid targets', async () => {
    await expect(notificationService.bulkCreate(org, [member, other], content)).rejects.toThrow('Invalid notification recipients');
    expect(mocks.bulk).not.toHaveBeenCalled();
  });
  it('preserves duplicate target behavior while validating distinct recipients', async () => {
    mocks.bulk.mockResolvedValue({ count: 2 });
    await expect(notificationService.bulkCreate(org, [member, member], content)).resolves.toEqual({ count: 2 });
    expect(mocks.bulk).toHaveBeenCalledWith({ data: [
      { ...content, userId: member, organizationId: org }, { ...content, userId: member, organizationId: org },
    ] });
  });
  it('treats UUID case variants as the same recipient without dropping notifications', async () => {
    const lower = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mocks.query.mockResolvedValue([{ id: lower }]);
    mocks.bulk.mockResolvedValue({ count: 2 });
    await expect(notificationService.bulkCreate(org, [lower, lower.toUpperCase()], content)).resolves.toEqual({ count: 2 });
    const sql = mocks.query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toEqual([org, lower]);
  });
  it('fails closed when no organization is resolved', async () => {
    await expect(notificationService.create(null, member, content)).rejects.toThrow('Invalid notification recipients');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
