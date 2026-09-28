import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ provider: vi.fn() }));
vi.stubGlobal('fetch', state.provider);

import { POST } from '../../apps/web/app/api/auth/password-update/route';

const recoveredUserId = '44444444-4444-4444-8444-444444444444';

function request(userId = recoveredUserId) {
  return new Request('https://app.test/api/auth/password-update', {
    method: 'POST',
    headers: {
      origin: 'https://app.test',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer captured.access.token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: 'a-private-staff-password', userId }),
  });
}

beforeEach(() => {
  state.provider.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.example';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';
  state.provider.mockImplementation(async (_url: URL, init: RequestInit) => {
    if (init.method === 'GET') {
      return new Response(JSON.stringify({ id: recoveredUserId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: recoveredUserId }), { status: 200 });
  });
});

describe('password update token binding', () => {
  it('validates and updates with the same captured bearer token', async () => {
    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(state.provider).toHaveBeenCalledTimes(2);
    const [, getOptions] = state.provider.mock.calls[0] as [URL, RequestInit];
    const [, putOptions] = state.provider.mock.calls[1] as [URL, RequestInit];
    expect(new Headers(getOptions.headers).get('authorization')).toBe('Bearer captured.access.token');
    expect(new Headers(putOptions.headers).get('authorization')).toBe('Bearer captured.access.token');
    expect(putOptions.method).toBe('PUT');
    expect(putOptions.body).toBe(JSON.stringify({ password: 'a-private-staff-password' }));
  });

  it('refuses to mutate when the token identity differs from the recovered identity', async () => {
    state.provider.mockResolvedValueOnce(new Response(JSON.stringify({ id: recoveredUserId }), { status: 200 }));
    const response = await POST(request('55555555-5555-4555-8555-555555555555'));

    expect(response.status).toBe(403);
    expect(state.provider).toHaveBeenCalledTimes(1);
  });

  it('preserves only the allowlisted MFA step-up signal from Supabase', async () => {
    state.provider
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: recoveredUserId }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'insufficient_aal', message: 'private provider detail' }), { status: 403 }),
      );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'mfa_required' });
  });

  it('does not expose other provider errors', async () => {
    state.provider
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: recoveredUserId }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'provider_private', message: 'private provider detail' }), { status: 422 }),
      );

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'password_update_unavailable' });
  });
});
