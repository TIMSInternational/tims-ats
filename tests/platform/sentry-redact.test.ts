import { describe, expect, it } from 'vitest';
import { redactJoinTokens, redactSentryEvent } from '../../apps/web/lib/sentry-redact';

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
      '/login?next=%2Finterview%2Fjoin%2F[redacted]&x=1',
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
