import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../apps/web/app/api/interview-join/route';
import { isSafeDailyJoinUrl, isValidInterviewJoinToken } from '../../apps/web/lib/interview-join';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://api.example.test');
  vi.stubEnv('NEXTAUTH_SECRET', 'relay-test-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({
      outcome: 'ready',
      scheduledAt: null,
      joinOpensAt: null,
      joinUrl: 'https://tims.daily.co/tims-1234abcd?t=x',
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function input(body: string | Uint8Array = JSON.stringify({ token: TOKEN }), headers: Record<string, string> = {}) {
  return new Request('https://app.example.test/api/interview-join', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'content-type': 'application/json',
      cookie: 'sb-access-token=private',
      ...headers,
    },
    body,
  });
}

describe('candidate interview join relay', () => {
  it('relays only the token to the C# join route with signed attribution and no ambient cookies', async () => {
    const response = await POST(input());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/interviews/candidate-join');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Headers };
    expect(init.headers.get('cookie')).toBeNull();
    expect(init.headers.get('authorization')).toBeNull();
    expect(init.headers.get('x-tims-relay-attribution')).toMatch(/^[^.]+\.[^.]+$/);
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
    expect((await response.json()).outcome).toBe('ready');
  });

  it('rejects cross-origin and cross-site requests before contacting the API', async () => {
    expect((await POST(input(undefined, { origin: 'https://attacker.test' }))).status).toBe(403);
    expect((await POST(input(undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens, extra fields and oversized bodies before contacting the API', async () => {
    for (const body of [
      JSON.stringify({ token: 'short' }),
      JSON.stringify({ token: `${TOKEN}x` }),
      JSON.stringify({ token: TOKEN.replace('_', '+') }),
      JSON.stringify({ token: TOKEN, organizationId: 'x' }),
      '{not json',
    ]) {
      expect((await POST(input(body))).status).toBe(400);
    }
    expect((await POST(input(new Uint8Array(1025)))).status).toBe(413);
    expect((await POST(input(undefined, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never forwards an upstream answer outside the documented outcome shape', async () => {
    fetchMock.mockResolvedValue(Response.json({ outcome: 'ready', joinUrl: 'https://x.daily.co/r', debug: 'private' }));
    const response = await POST(input());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private');
    fetchMock.mockResolvedValue(new Response('stack trace', { status: 500 }));
    expect(await (await POST(input())).text()).not.toContain('stack');
  });
});

describe('join helpers', () => {
  it('accepts only 43-character base64url tokens', () => {
    expect(isValidInterviewJoinToken(TOKEN)).toBe(true);
    expect(isValidInterviewJoinToken(TOKEN.slice(1))).toBe(false);
    expect(isValidInterviewJoinToken(`${TOKEN.slice(1)}=`)).toBe(false);
    expect(isValidInterviewJoinToken(42)).toBe(false);
  });

  it.each([
    ['https://tims.daily.co/room?t=abc', true],
    ['http://tims.daily.co/room', false],
    ['https://daily.co/room', false],
    ['https://tims.daily.co.evil.test/room', false],
    ['https://evil.test/tims.daily.co', false],
    ['https://user:pw@tims.daily.co/room', false],
    ['https://tims.daily.co:8443/room', false],
    ['javascript:alert(1)//.daily.co', false],
    ['not a url', false],
  ])('redirects only to a Daily hosted room: %s → %s', (url, safe) => {
    expect(isSafeDailyJoinUrl(url)).toBe(safe);
  });
});
