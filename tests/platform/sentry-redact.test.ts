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
