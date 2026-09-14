import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { signRelayAttribution } from '../../apps/web/lib/platform-api/relay-attribution';

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 'relay-test-secret');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const upstream = new URL('https://platform.test/notification');
function sign(ip: string) {
  return signRelayAttribution(
    new Request('https://web.test/api/platform/notification', {
      headers: { 'x-real-ip': ip, 'x-forwarded-for': '6.6.6.6', 'user-agent': 'browser-test' },
    }),
    upstream,
    'Bearer token',
    'tims_impersonation=signed',
  );
}
it('signs distinct edge IPs and bounded UA with purpose-separated signature', () => {
  vi.stubEnv('VERCEL', '1');
  for (const ip of ['203.0.113.1', '203.0.113.2']) {
    const [body, signature] = sign(ip).split('.');
    expect(
      createHmac('sha256', 'relay-test-secret')
        .update('tims-platform-relay-attribution-v1\n' + body)
        .digest('base64url'),
    ).toBe(signature);
    const metadata = JSON.parse(Buffer.from(body!, 'base64url').toString());
    expect(metadata.ip).toBe(ip);
    expect(metadata.ua).toBe('browser-test');
    expect(metadata.path).toBe('/notification');
    expect(metadata.authorizationHash).toHaveLength(64);
    expect(metadata.cookieHash).toHaveLength(64);
  }
});
it('never signs arbitrary IP headers from a custom/local untrusted deployment', () => {
  vi.stubEnv('VERCEL', '');
  expect(JSON.parse(Buffer.from(sign('6.6.6.6').split('.')[0]!, 'base64url').toString()).ip).toBeNull();
});
it('rejects absent signing secret and invalid edge addresses', () => {
  vi.stubEnv('VERCEL', '1');
  expect(JSON.parse(Buffer.from(sign('attacker').split('.')[0]!, 'base64url').toString()).ip).toBeNull();
  vi.stubEnv('NEXTAUTH_SECRET', '');
  expect(() => sign('203.0.113.1')).toThrow();
});
