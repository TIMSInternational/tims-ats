import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../apps/web/app/api/invitation-setup/[action]/route';

const fetch = vi.fn();
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://api.example.test');
  vi.stubEnv('NEXTAUTH_SECRET', 'relay-test-secret');
  vi.stubGlobal('fetch', fetch);
  fetch.mockReset();
  fetch.mockResolvedValue(Response.json({ outcome: 'complete' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function input(action: string, options: RequestInit = {}) {
  return new Request(`https://app.example.test/api/invitation-setup/${action}`, {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json', cookie: 'private=session' },
    body: '{}',
    ...options,
  });
}

it('forwards only the requested capability route and never ambient cookies', async () => {
  const response = await POST(input('preview'), { params: Promise.resolve({ action: 'preview' }) });
  expect(response.status).toBe(200);
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.example.test/invitations/setup/preview');
  expect(fetch.mock.calls[0]?.[1].headers.get('cookie')).toBeNull();
  expect(fetch.mock.calls[0]?.[1].headers.get('x-tims-relay-attribution')).toMatch(/^[^.]+\.[^.]+$/);
});

it('requires an explicit bearer credential for completion', async () => {
  expect((await POST(input('complete'), { params: Promise.resolve({ action: 'complete' }) })).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects cross-origin, arbitrary-route and oversized requests before contacting the API', async () => {
  expect(
    (
      await POST(
        input('register', { headers: { origin: 'https://attacker.test', 'content-type': 'application/json' } }),
        { params: Promise.resolve({ action: 'register' }) },
      )
    ).status,
  ).toBe(403);
  expect((await POST(input('admin'), { params: Promise.resolve({ action: 'admin' }) })).status).toBe(404);
  expect(
    (await POST(input('register', { body: new Uint8Array(8193) }), { params: Promise.resolve({ action: 'register' }) }))
      .status,
  ).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not forward provider error details to the browser', async () => {
  fetch.mockResolvedValue(new Response('private provider exception', { status: 500 }));
  const response = await POST(input('preview'), { params: Promise.resolve({ action: 'preview' }) });
  expect(await response.text()).not.toContain('private');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('preserves only the safe MFA step-up signal', async () => {
  fetch.mockResolvedValue(Response.json({ message: 'MFA_REQUIRED', detail: 'private' }, { status: 403 }));
  const response = await POST(
    input('complete', {
      headers: {
        origin: 'https://app.example.test',
        'content-type': 'application/json',
        authorization: 'Bearer valid.token',
      },
    }),
    { params: Promise.resolve({ action: 'complete' }) },
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'mfa_required' });
});
