import { describe, expect, it } from 'vitest';

import { POST } from '../../apps/web/app/api/auth/password-setup/route';

const nonce = '22222222-2222-4222-8222-222222222222';

describe('password setup recovery proof', () => {
  it('accepts a nonce only when it matches the HttpOnly callback cookie', async () => {
    const response = await POST(
      new Request(`https://app.test/api/auth/password-setup?nonce=${nonce}`, {
        method: 'POST',
        headers: { cookie: `tims-password-setup-proof=${nonce}.11111111-1111-4111-8111-111111111111` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, userId: '11111111-1111-4111-8111-111111111111' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('tims-password-setup-proof=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('consumes and rejects a forged nonce', async () => {
    const response = await POST(
      new Request('https://app.test/api/auth/password-setup?nonce=33333333-3333-4333-8333-333333333333', {
        method: 'POST',
        headers: { cookie: `tims-password-setup-proof=${nonce}.11111111-1111-4111-8111-111111111111` },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ valid: false, userId: null });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
