import { describe, expect, it } from 'vitest';
import { redactBearerTokens, redactSentryEvent } from '../../apps/web/lib/sentry-redact';
import { BEARER_TOKEN_PATH_PREFIXES, isBearerLinkPathname } from '../../apps/web/lib/security/bearer-links';

const redactJoinTokens = redactBearerTokens;

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

describe('Sentry join-token redaction', () => {
  it('scrubs the token from absolute, relative and query-suffixed join URLs', () => {
    expect(redactJoinTokens(`https://ats.example/interview/join/${TOKEN}`)).toBe(
      'https://ats.example/interview/join/[redacted]',
    );
    expect(redactJoinTokens(`/interview/join/${TOKEN}?x=1#y`)).toBe('/interview/join/[redacted]?x=1#y');
    expect(redactJoinTokens('/recruitment/interviews/abc/room')).toBe('/recruitment/interviews/abc/room');
  });

  it('scrubs the %2F-encoded join path in any hex case (#329)', () => {
    expect(redactJoinTokens(`/login?next=%2Finterview%2Fjoin%2F${TOKEN}`)).toBe(
      '/login?next=%2Finterview%2Fjoin%2F[redacted]',
    );
    expect(redactJoinTokens(`/login?next=%2finterview%2fjoin%2f${TOKEN}&x=1`)).toBe(
      '/login?next=%2finterview%2fjoin%2f[redacted]&x=1',
    );
    expect(redactJoinTokens(`https://ats.example/interview%2Fjoin%2F${TOKEN}`)).not.toContain(TOKEN);
  });

  it('scrubs any 43-char base64url token that follows "join", whatever the URL shape (#329)', () => {
    for (const value of [
      `join=${TOKEN}`,
      `{"join":"${TOKEN}"}`,
      `candidate join: ${TOKEN}`,
      `/api/join/${TOKEN}`,
      `JOIN%3D${TOKEN}`,
    ]) {
      const redacted = redactJoinTokens(value);
      expect(redacted, value).not.toContain(TOKEN);
      expect(redacted, value).toContain('[redacted]');
    }
  });

  it('scrubs a JSON "token" value (plain and JSON-escaped) and a double-encoded join path (review LOW-9)', () => {
    for (const value of [
      `{"token":"${TOKEN}"}`,
      `{ "token" : "${TOKEN}" }`,
      `"body":"{\\"token\\":\\"${TOKEN}\\"}"`,
      `/login?next=%252Finterview%252Fjoin%252F${TOKEN}`,
    ]) {
      const redacted = redactJoinTokens(value);
      expect(redacted, value).not.toContain(TOKEN);
      expect(redacted, value).toContain('[redacted]');
    }
    // An object event: the request body field itself is scrubbed.
    const event = redactSentryEvent({ request: { data: { token: TOKEN } }, extra: { body: `{"token":"${TOKEN}"}` } });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it('scrubs a JSON credential whose value contains JSON escapes, plain and nested (codex r6 P1)', () => {
    // `\u0039` decodes to `9`: JSON.parse would rebuild the credential from what is left behind.
    const escaped = `\\u0039${TOKEN.slice(1)}`;
    const plain = `{"0":{"json":{"token":"${escaped}","x":1}}}`;
    const nested = `"body":"{\\"token\\":\\"\\${escaped}\\",\\"x\\":1}"`;
    for (const value of [plain, nested]) {
      const redacted = redactBearerTokens(value);
      expect(redacted, value).not.toContain(TOKEN.slice(1));
      expect(redacted, value).toContain('[redacted]');
    }
    expect(redactBearerTokens(plain)).toBe('{"0":{"json":{"token":"[redacted]","x":1}}}');
    const event = redactSentryEvent({ request: { data: plain } });
    expect(JSON.stringify(event)).not.toContain(TOKEN.slice(1));
  });

  it('leaves unrelated or non-token-shaped values alone', () => {
    // 42 and 44 characters: not the token shape. No "join" prefix: not this rule's business.
    const short = TOKEN.slice(0, 42);
    const long = `${TOKEN}x`;
    expect(redactJoinTokens(`join=${short}`)).toBe(`join=${short}`);
    expect(redactJoinTokens(`join=${long}`)).toBe(`join=${long}`);
    expect(redactJoinTokens(`session=${TOKEN}`)).toBe(`session=${TOKEN}`);
    expect(redactJoinTokens('/recruitment/interviews/abc/join-requests')).toBe('/recruitment/interviews/abc/join-requests');
  });

  it('scrubs every string of an error / transaction event, including nested breadcrumbs and spans', () => {
    const event = {
      request: { url: `https://ats.example/interview/join/${TOKEN}` },
      transaction: `/interview/join/${TOKEN}`,
      breadcrumbs: [{ category: 'navigation', data: { from: '/', to: `/interview/join/${TOKEN}` } }],
      spans: [{ description: `GET /interview/join/${TOKEN}`, data: { 'http.url': `/interview/join/${TOKEN}` } }],
      contexts: { trace: { op: 'pageload' } },
      level: 'error',
      timestamp: 1,
    };
    const redacted = redactSentryEvent(event);
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(redacted.level).toBe('error');
    expect(redacted.timestamp).toBe(1);
  });
});

describe('Sentry bearer-link redaction beyond the join link (offers, AI interview, query credentials)', () => {
  const UUID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
  const SECRET = 'S3cr3t-Value_123';

  it('scrubs the path token of EVERY bearer-link route, taken from the shared route list', () => {
    for (const prefix of BEARER_TOKEN_PATH_PREFIXES) {
      for (const value of [
        `https://ats.example${prefix}${UUID}`,
        `${prefix}${UUID}?x=1`,
        `/login?next=${encodeURIComponent(`${prefix}${UUID}`)}`,
        `/login?next=${encodeURIComponent(encodeURIComponent(`${prefix}${UUID}`))}`,
      ]) {
        const redacted = redactBearerTokens(value);
        expect(redacted, value).not.toContain(UUID);
        expect(redacted, value).toContain('[redacted]');
      }
    }
    expect(redactBearerTokens(`/offers/sign/${UUID}`)).toBe('/offers/sign/[redacted]');
    expect(redactBearerTokens(`/ai-interview/${UUID}`)).toBe('/ai-interview/[redacted]');
  });

  it('covers the offer-signing and AI-interview routes (and the middleware treats them as bearer links)', () => {
    expect(BEARER_TOKEN_PATH_PREFIXES).toEqual(
      expect.arrayContaining(['/offers/sign/', '/ai-interview/', '/interview/join/']),
    );
    expect(isBearerLinkPathname(`/ai-interview/${UUID}`)).toBe(true);
    expect(isBearerLinkPathname('/ai-interviewer')).toBe(false);
  });

  it('scrubs credential query values anywhere in a URL, including an encoded nested URL', () => {
    for (const [value, expected] of [
      [`/accept-invitation?token=${SECRET}`, '/accept-invitation?token=[redacted]'],
      [`https://ats.example/reset-password?lang=es&token=${SECRET}#x`, 'https://ats.example/reset-password?lang=es&token=[redacted]#x'],
      [`/auth/callback?code=${SECRET}&next=/home`, '/auth/callback?code=[redacted]&next=/home'],
      [`/reset-password#access_token=${SECRET}&refresh_token=${SECRET}&type=recovery`, '/reset-password#access_token=[redacted]&refresh_token=[redacted]&type=recovery'],
      [`token=${SECRET}&x=1`, 'token=[redacted]&x=1'],
      [`/login?next=%2Faccept-invitation%3Ftoken%3D${SECRET}%2B%2F%26a%3Db`, '/login?next=%2Faccept-invitation%3Ftoken%3D[redacted]%26a%3Db'],
    ] as const) {
      expect(redactBearerTokens(value), value).toBe(expected);
    }
    // Not a credential parameter, or not at a parameter boundary.
    expect(redactBearerTokens(`/x?session=${SECRET}&x_token=${SECRET}`)).toBe(`/x?session=${SECRET}&x_token=${SECRET}`);
  });

  it('scrubs request.url, query_string (string, object and pair forms), breadcrumbs and transaction names', () => {
    const event = {
      request: {
        url: `https://ats.example/offers/sign/${UUID}?token=${SECRET}`,
        query_string: `token=${SECRET}`,
        data: { signingToken: SECRET, candidateToken: SECRET, access_token: SECRET },
      },
      transaction: `/ai-interview/${UUID}`,
      breadcrumbs: [
        { category: 'navigation', data: { from: `/reset-password?code=${SECRET}`, to: `/offers/sign/${UUID}` } },
        { category: 'fetch', data: { url: `/api/trpc/x?input=%7B%22token%22%3A1%7D&token=${SECRET}` } },
      ],
      extra: {
        qsObject: { query_string: { token: SECRET, code: SECRET, keep: 'ok' } },
        qsPairs: { query_string: [['token', SECRET], ['Code', SECRET], ['keep', 'ok']] },
        body: `{"signingToken":"${SECRET}"}`,
      },
      level: 'error',
    };
    const redacted = redactSentryEvent(event);
    const json = JSON.stringify(redacted);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(UUID);
    expect(redacted.extra.qsObject.query_string.keep).toBe('ok');
    expect(redacted.extra.qsPairs.query_string[2]).toEqual(['keep', 'ok']);
    expect(redacted.level).toBe('error');
  });

  it('scrubs a credential sent as tRPC GET input (percent-encoded superjson, once or twice)', () => {
    for (const [key, procedure] of [
      ['token', 'offer.getBySigningToken'],
      ['candidateToken', 'aiInterview.getSession'],
    ] as const) {
      const input = encodeURIComponent(JSON.stringify({ 0: { json: { [key]: UUID } } }));
      const url = `https://ats.example/api/trpc/${procedure}?batch=1&input=${input}`;
      const redacted = redactBearerTokens(url);
      expect(redacted, url).not.toContain(UUID);
      expect(redacted, url).toContain(`%22${key}%22%3A%22[redacted]%22%7D`);

      const nested = `/login?next=${encodeURIComponent(url)}`;
      expect(redactBearerTokens(nested), nested).not.toContain(UUID);

      const event = redactSentryEvent({ breadcrumbs: [{ category: 'fetch', data: { url, method: 'GET' } }] });
      expect(JSON.stringify(event)).not.toContain(UUID);
    }
    // Other encoded members are untouched.
    const other = encodeURIComponent(JSON.stringify({ 0: { json: { vacancyId: UUID } } }));
    expect(redactBearerTokens(`/api/trpc/portal.getVacancy?input=${other}`)).toContain(UUID);
  });

  it('scrubs the invitation token and recovery proof on the password-setup redirect (URL and query_string)', () => {
    const url = `https://ats.example/reset-password?recovery=${UUID}&invitation=${SECRET}`;
    expect(redactBearerTokens(url)).toBe('https://ats.example/reset-password?recovery=[redacted]&invitation=[redacted]');
    const event = redactSentryEvent({
      request: { url, query_string: { recovery: UUID, invitation: SECRET } },
      breadcrumbs: [{ data: { to: `/auth/confirm?token_hash=${SECRET}&type=invite` } }],
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(UUID);
  });

  it('scrubs credential query values in a DOUBLY encoded nested URL', () => {
    for (const value of [
      `/login?next=%252Faccept-invitation%253Ftoken%253D${SECRET}`,
      `/login?next=%252Freset-password%253Frecovery%253D1%2526invitation%253D${SECRET}%2526x%253D1`,
      `/login?next=${encodeURIComponent(encodeURIComponent(`/accept-invitation?token=${SECRET}&a=b`))}`,
    ]) {
      const redacted = redactBearerTokens(value);
      expect(redacted, value).not.toContain(SECRET);
      expect(redacted, value).toContain('[redacted]');
    }
    // The following double-encoded parameter survives.
    expect(redactBearerTokens(`/login?next=%252Fx%253Ftoken%253D${SECRET}%2526keep%253Dyes`)).toContain('%2526keep%253Dyes');
  });

  it('normalizes encodings the patterns do not anticipate: escaped token characters, encoded JSON whitespace', () => {
    const escapedChar = `/login?next=%2Faccept-invitation%3Ftoken%3D%25${UUID}`;
    const pretty = `/api/trpc/offer.getBySigningToken?input=${encodeURIComponent(JSON.stringify({ json: { token: UUID } }, null, 2))}`;
    const triple = `/login?next=${encodeURIComponent(encodeURIComponent(encodeURIComponent(`/offers/sign/${UUID}`)))}`;
    // An escape INSIDE the token: the first pass stops at it, the decoded level must remove the rest.
    const midEscape = `/login?next=%2Foffers%2Fsign%2F9%66${UUID.slice(2)}`;
    expect(redactBearerTokens(midEscape)).not.toContain(UUID.slice(2));
    expect(redactBearerTokens(`/offers/sign/9%66${UUID.slice(2)}`)).not.toContain(UUID.slice(2));
    for (const value of [escapedChar, pretty, triple, `/x?token=%41%42${SECRET.slice(2)}`]) {
      const redacted = redactBearerTokens(value);
      expect(redacted, value).not.toContain(UUID);
      expect(redacted, value).not.toContain(UUID.slice(1));
      expect(redacted, value).not.toContain(SECRET.slice(2));
      expect(redacted, value).toContain('[redacted]');
    }
    // Strings with no credential keep their original encoding; a stray `%` never throws.
    const plain = '/careers/acme?q=caf%C3%A9&page=2';
    expect(redactBearerTokens(plain)).toBe(plain);
    expect(redactBearerTokens('100% done %ZZ /x?token=abc')).toBe('100% done %ZZ /x?token=[redacted]');
  });

  it('is idempotent: scrubbing an already-scrubbed string changes nothing', () => {
    for (const value of [
      `/login?next=%2finterview%2fjoin%2f${UUID}&x=1`,
      `/login?next=%252Foffers%252Fsign%252F${UUID}`,
      `/reset-password?recovery=${UUID}&invitation=${SECRET}`,
      `/api/trpc/x?input=${encodeURIComponent(JSON.stringify({ json: { token: UUID } }))}`,
      `{"candidateToken":"${SECRET}"}`,
    ]) {
      const once = redactBearerTokens(value);
      expect(redactBearerTokens(once), value).toBe(once);
    }
  });
});
