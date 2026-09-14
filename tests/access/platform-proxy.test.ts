import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyPlatformRequest } from '../../apps/web/lib/platform-api/proxy';

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 'test-relay-secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const request = (headers: Record<string, string> = {}) =>
  new Request('https://tims.test/api/platform/audit/logs?page=1', {
    headers: { authorization: 'Bearer test.jwt.signature', ...headers },
  });

describe('platform bearer relay', () => {
  it('carries only signed impersonation cookie and bearer to fixed upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://platform.test');
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"ok":true}', { headers: { 'set-cookie': 'secret=value' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPlatformRequest(
      request({ cookie: 'session=secret; tims_impersonation=signed.token', 'x-user-id': 'owner' }),
    );
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://platform.test/audit/logs?page=1');
    expect(options.headers.get('cookie')).toBe('tims_impersonation=signed.token');
    expect(options.headers.get('x-user-id')).toBeNull();
    expect(options.redirect).toBe('error');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not authenticate with ambient cookies', async () => {
    expect(
      (
        await proxyPlatformRequest(
          new Request('https://tims.test/api/platform/audit/logs', { headers: { cookie: 'session=x' } }),
        )
      ).status,
    ).toBe(401);
  });
  it('rejects cross-origin requests', async () => {
    expect((await proxyPlatformRequest(request({ origin: 'https://other.test' }))).status).toBe(403);
  });
  it('rejects an unsafe upstream and duplicate impersonation cookies', async () => {
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'http://localhost.evil.test');
    expect((await proxyPlatformRequest(request())).status).toBe(503);
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://platform.test');
    expect((await proxyPlatformRequest(request({ cookie: 'tims_impersonation=a; tims_impersonation=b' }))).status).toBe(
      400,
    );
  });
  it('bounds bodies before forwarding', async () => {
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://platform.test');
    const response = await proxyPlatformRequest(
      new Request('https://tims.test/api/platform/test', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: 'x'.repeat(1_048_577),
      }),
    );
    expect(response.status).toBe(413);
  });
});

it('routes browser reads and writes through same-origin transport', async () => {
  vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://platform.test');
  vi.doMock('@tims/auth/client', () => ({
    createSupabaseBrowserClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'test.jwt.signature' } } }) },
    }),
  }));
  const fetcher = vi
    .fn()
    .mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const { platformGetRaw, platformPostRaw } = await import('../../apps/web/lib/platform-api/client');
  await platformGetRaw('/audit/logs');
  await platformPostRaw('/test', {});
  for (const [url, options] of fetcher.mock.calls) {
    expect(url).toMatch(/^\/api\/platform\//);
    expect(options.credentials).toBe('same-origin');
    expect(options.headers.Authorization).toBe('Bearer test.jwt.signature');
  }
});
