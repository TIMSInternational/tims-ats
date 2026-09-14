import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrganization: vi.fn(), findExisting: vi.fn(), findForResend: vi.fn(), markResent: vi.fn(), createPending: vi.fn(), markSent: vi.fn(), sendEmail: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/bulk-invitation.repository', () => ({ bulkInvitationRepository: mocks }));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@tims/shared', () => ({ getAppUrl: () => 'https://tims.example' }));
import { bulkInviteUsers, resendInvitation } from '../../packages/api/src/services/bulk-invitation.service';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findOrganization.mockResolvedValue({ name: 'Acme' });
  mocks.findExisting.mockResolvedValue([]);
  mocks.createPending.mockResolvedValue({ id: 'invite-1' });
  mocks.markSent.mockResolvedValue({ count: 1 });
  mocks.sendEmail.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

describe('bulk invitation delivery', () => {
  it('sends the persisted acceptance token and marks sent only after provider acceptance', async () => {
    mocks.sendEmail.mockImplementation(async () => {
      expect(mocks.createPending).toHaveBeenCalledOnce();
      expect(mocks.markSent).not.toHaveBeenCalled();
      return true;
    });
    const result = await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com' }]);
    const pending = mocks.createPending.mock.calls[0][0];
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain(`?token=${pending.token}`);
    expect(mocks.markSent).toHaveBeenCalledWith('invite-1', 'org');
    expect(result?.summary).toEqual({ total: 1, sent: 1, duplicates: 0, errors: 0 });
  });

  it('keeps failed delivery pending and reports error rather than sent', async () => {
    mocks.sendEmail.mockResolvedValue(false);
    const result = await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com' }]);
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(result?.summary.sent).toBe(0);
    expect(result?.summary.errors).toBe(1);
  });

  it('continues the batch after a delivery exception', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('provider unavailable'));
    const result = await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com' }, { email: 'b@example.com' }]);
    expect(result?.summary).toEqual({ total: 2, sent: 1, duplicates: 0, errors: 1 });
  });

  it('does not send for existing or repeated recipients, ignoring case', async () => {
    mocks.createPending.mockImplementation(async (input) => input.email.toLowerCase() === 'existing@example.com' ? null : { id: 'new' });
    const result = await bulkInviteUsers('org', 'owner', [
      { email: 'existing@example.com' }, { email: 'new@example.com' }, { email: 'NEW@example.com' },
    ]);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(result?.summary).toEqual({ total: 3, sent: 1, duplicates: 2, errors: 0 });
  });

  it('escapes organization and role text in the email', async () => {
    mocks.findOrganization.mockResolvedValue({ name: '<img src=x onerror=alert(1)>' });
    await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com', roleSlug: '<script>evil</script>' }]);
    const html = mocks.sendEmail.mock.calls[0][0].html;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('does not claim success when the invitation changes during delivery', async () => {
    mocks.markSent.mockResolvedValue({ count: 0 });
    const result = await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com' }]);
    expect(result?.summary.sent).toBe(0);
    expect(result?.summary.errors).toBe(1);
  });

  it('does not send if persistence fails or the organization is missing', async () => {
    mocks.createPending.mockRejectedValue(new Error('database unavailable'));
    expect((await bulkInviteUsers('org', 'owner', [{ email: 'a@example.com' }]))?.summary.errors).toBe(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    mocks.findOrganization.mockResolvedValue(null);
    expect(await bulkInviteUsers('missing', 'owner', [{ email: 'a@example.com' }])).toBeNull();
  });
});

describe('delivery request budget and resend', () => {
  it('limits provider calls to four concurrent sends and reports unattempted recipients', async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    mocks.sendEmail.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 4_000));
      active--;
      return false;
    });
    const work = bulkInviteUsers('org', 'owner', Array.from({ length: 200 }, (_, i) => ({ email: `u${i}@example.com` })));
    await vi.runAllTimersAsync();
    const result = await work;
    expect(peak).toBe(4);
    expect(result?.results).toHaveLength(200);
    expect(result?.results.some(row => row.message?.startsWith('Not attempted:'))).toBe(true);
    expect(mocks.sendEmail.mock.calls.length).toBeLessThan(200);
    expect(mocks.sendEmail.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(result?.summary.sent).toBe(0);
  });
  it('does not mark a pending resend sent after provider failure', async () => {
    mocks.findForResend.mockResolvedValue({ id: 'id', email: 'a@example.com', token: 'token', status: 'pending', organizationName: 'Acme' });
    mocks.sendEmail.mockResolvedValue(false);
    expect(await resendInvitation('id')).toEqual({ error: 'delivery_failed' });
    expect(mocks.markResent).not.toHaveBeenCalled();
  });
  it('updates resend only after provider success and does not resurrect revoked state', async () => {
    mocks.findForResend.mockResolvedValue({ id: 'id', email: 'a@example.com', token: 'token', status: 'pending', organizationName: 'Acme' });
    mocks.markResent.mockResolvedValue({ count: 0 });
    expect(await resendInvitation('id')).toEqual({ error: 'invalid_status' });
    expect(mocks.sendEmail.mock.invocationCallOrder[0]).toBeLessThan(mocks.markResent.mock.invocationCallOrder[0]);
  });
});
