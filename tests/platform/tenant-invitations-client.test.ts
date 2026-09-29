import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), enabled: true }));
vi.mock('../../apps/web/lib/platform-api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/lib/platform-api/client')>();
  return {
    ...actual,
    platformGetRaw: mocks.get,
    platformPostRaw: mocks.post,
    isPlatformApiEnabled: () => mocks.enabled,
  };
});

import {
  TenantInvitationsUnavailableError,
  createTenantInvitation,
  fetchTenantInvitationRoles,
  fetchTenantInvitations,
  isTenantInvitationsEnabled,
  resendTenantInvitation,
  revokeTenantInvitation,
} from '../../apps/web/lib/platform-api/tenant-invitations';

const ID = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const invitation = {
  id: ID,
  email: 'ana@example.test',
  roleSlug: 'recruiter',
  status: 'sent',
  createdAt: '2026-09-20T10:00:00Z',
  expiresAt: '2026-09-27T10:00:00.123456+00:00',
  sentAt: '2026-09-20T10:00:01Z',
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP = 'true';
  mocks.enabled = true;
  mocks.get.mockReset();
  mocks.post.mockReset();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP;
});

describe('tenant invitations flag', () => {
  it('is dark unless both the flag and the platform URL are set', () => {
    expect(isTenantInvitationsEnabled()).toBe(true);
    mocks.enabled = false;
    expect(isTenantInvitationsEnabled()).toBe(false);
    mocks.enabled = true;
    process.env.NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP = 'false';
    expect(isTenantInvitationsEnabled()).toBe(false);
  });

  it('fails closed without any request when off', async () => {
    delete process.env.NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP;
    await expect(fetchTenantInvitationRoles()).rejects.toBeInstanceOf(TenantInvitationsUnavailableError);
    await expect(fetchTenantInvitations()).rejects.toBeInstanceOf(TenantInvitationsUnavailableError);
    await expect(createTenantInvitation({ email: 'a@b.test', roleSlug: 'employee' })).rejects.toBeInstanceOf(
      TenantInvitationsUnavailableError,
    );
    await expect(resendTenantInvitation(ID)).rejects.toBeInstanceOf(TenantInvitationsUnavailableError);
    await expect(revokeTenantInvitation(ID)).rejects.toBeInstanceOf(TenantInvitationsUnavailableError);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe('GET /tenant-invitations/roles', () => {
  it('parses the grantable roles', async () => {
    mocks.get.mockResolvedValue({ roles: [{ slug: 'employee', name: 'Empleado' }] });
    await expect(fetchTenantInvitationRoles()).resolves.toEqual([{ slug: 'employee', name: 'Empleado' }]);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/tenant-invitations/roles');
  });
  it.each([{ roles: [{ slug: 'employee', name: 'E', id: 'x' }] }, { roles: [{ slug: '', name: 'E' }] }, {}])(
    'rejects an off-contract body %j',
    async (body) => {
      mocks.get.mockResolvedValue(body);
      await expect(fetchTenantInvitationRoles()).rejects.toThrow();
    },
  );
});

describe('GET /tenant-invitations', () => {
  it('parses open invitations (Z and offset timestamps, null sentAt/roleSlug)', async () => {
    mocks.get.mockResolvedValue({
      invitations: [invitation, { ...invitation, roleSlug: null, sentAt: null, status: 'pending' }],
    });
    const result = await fetchTenantInvitations();
    expect(result).toHaveLength(2);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/tenant-invitations');
  });
  it.each([
    { ...invitation, status: 'accepted' },
    { ...invitation, token: 'secret' },
    { ...invitation, expiresAt: 'tomorrow' },
    { ...invitation, id: 'not-a-uuid' },
  ])('rejects an off-contract invitation', async (bad) => {
    mocks.get.mockResolvedValue({ invitations: [bad] });
    await expect(fetchTenantInvitations()).rejects.toThrow();
  });
  it('rejects more than 100 rows', async () => {
    mocks.get.mockResolvedValue({ invitations: Array.from({ length: 101 }, () => invitation) });
    await expect(fetchTenantInvitations()).rejects.toThrow();
  });
});

describe('POST /tenant-invitations', () => {
  it('sends only {email, roleSlug} — never an organizationId — and returns the delivery outcome', async () => {
    mocks.post.mockResolvedValue({ id: ID, organizationId: ORG, delivery: 'unconfirmed' });
    await expect(createTenantInvitation({ email: ' ana@example.test ', roleSlug: 'recruiter' })).resolves.toBe(
      'unconfirmed',
    );
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/tenant-invitations', {
      email: 'ana@example.test',
      roleSlug: 'recruiter',
    });
  });
  it('refuses a caller-supplied organizationId before any request', async () => {
    const input = { email: 'ana@example.test', roleSlug: 'recruiter', organizationId: ORG } as unknown as {
      email: string;
      roleSlug: string;
    };
    await expect(createTenantInvitation(input)).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([
    { email: 'x'.repeat(250) + '@b.test', roleSlug: 'employee' },
    { email: 'ana@example.test', roleSlug: '' },
  ])('refuses out-of-bounds input before any request', async (input) => {
    await expect(createTenantInvitation(input)).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([
    { id: ID, organizationId: ORG, delivery: 'sent' },
    { id: ID, delivery: 'accepted' },
  ])('rejects an off-contract create response', async (body) => {
    mocks.post.mockResolvedValue(body);
    await expect(createTenantInvitation({ email: 'ana@example.test', roleSlug: 'recruiter' })).rejects.toThrow();
  });
});

describe('POST /tenant-invitations/{id}/resend and /revoke', () => {
  it('resends through the templated path with a JSON body', async () => {
    mocks.post.mockResolvedValue({
      id: ID,
      status: 'sent',
      sentAt: '2026-09-29T10:00:00Z',
      expiresAt: '2026-10-06T10:00:00Z',
    });
    await resendTenantInvitation(ID);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/tenant-invitations/{id}/resend', {}, { id: ID });
  });
  it('rejects a resend response for another invitation or with expiry before send', async () => {
    mocks.post.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'sent',
      sentAt: '2026-09-29T10:00:00Z',
      expiresAt: '2026-10-06T10:00:00Z',
    });
    await expect(resendTenantInvitation(ID)).rejects.toThrow();
    mocks.post.mockResolvedValue({
      id: ID,
      status: 'sent',
      sentAt: '2026-09-29T10:00:00Z',
      expiresAt: '2026-09-28T10:00:00Z',
    });
    await expect(resendTenantInvitation(ID)).rejects.toThrow();
  });
  it('revokes through the templated path and validates the echo', async () => {
    mocks.post.mockResolvedValue({ id: ID, status: 'revoked' });
    await revokeTenantInvitation(ID);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/tenant-invitations/{id}/revoke', {}, { id: ID });
    mocks.post.mockResolvedValue({ id: ID, status: 'pending' });
    await expect(revokeTenantInvitation(ID)).rejects.toThrow();
  });
  it('refuses a non-uuid id before any request', async () => {
    await expect(resendTenantInvitation('../../platform/x')).rejects.toThrow();
    await expect(revokeTenantInvitation('abc')).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
