import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn(), find: vi.fn(), create: vi.fn() }));
vi.mock('@tims/db', () => ({ db: { $transaction: mocks.transaction }, InvitationStatus: { pending: 'pending', sent: 'sent', accepted: 'accepted' }, InvitationType: { user: 'user' } }));
import { bulkInvitationRepository } from '../../packages/api/src/repositories/bulk-invitation.repository';
const input = { email: 'PERSON@example.com', organizationId: 'ORG', organizationName: 'Org', token: 'token', invitedById: 'owner', expiresAt: new Date() };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async run => run({ $executeRaw: mocks.execute, platformInvitation: { findFirst: mocks.find, create: mocks.create } }));
  mocks.find.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: 'new' });
});
describe('atomic invitation reservation', () => {
  it('locks normalized organization/email before checking and inserting within a bounded transaction', async () => {
    expect(await bulkInvitationRepository.createPending(input)).toEqual({ id: 'new' });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000, maxWait: 1000 });
    expect(mocks.execute.mock.calls[0][0].join('')).toContain('statement_timeout');
    expect(mocks.execute.mock.calls[1][0].join('')).toContain('pg_advisory_xact_lock');
    expect(mocks.execute.mock.calls[1][1]).toBe('org:person@example.com');
    expect(mocks.execute.mock.invocationCallOrder[1]).toBeLessThan(mocks.find.mock.invocationCallOrder[0]);
    expect(mocks.find.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'ORG', email: { equals: input.email, mode: 'insensitive' }, status: { in: ['pending', 'sent', 'accepted'] } } }));
  });
  it('does not insert when a competing reservation already committed', async () => {
    mocks.find.mockResolvedValue({ id: 'existing' });
    expect(await bulkInvitationRepository.createPending(input)).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not query or insert if acquiring the database lock fails', async () => {
    mocks.execute.mockResolvedValueOnce(0).mockRejectedValueOnce(new Error('lock timeout'));
    await expect(bulkInvitationRepository.createPending(input)).rejects.toThrow('lock timeout');
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
