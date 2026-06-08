import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  signImpersonationToken,
  verifyImpersonationToken,
  readImpersonationCookie,
  IMPERSONATION_COOKIE,
} from '../../packages/api/src/lib/impersonation';

const SECRET = 'test-secret-for-impersonation';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

// Re-implements the wire format to forge tokens for negative tests.
function forge(payloadObj: unknown, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

describe('impersonation token', () => {
  it('round-trips a valid token', () => {
    const token = signImpersonationToken('owner-1', 'target-1');
    const payload = verifyImpersonationToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.impersonatorId).toBe('owner-1');
    expect(payload!.targetUserId).toBe('target-1');
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it('rejects a tampered body (signature mismatch)', () => {
    const token = signImpersonationToken('owner-1', 'target-1');
    const [, sig] = token.split('.');
    const evilBody = Buffer.from(
      JSON.stringify({ impersonatorId: 'owner-1', targetUserId: 'VICTIM', exp: Date.now() + 1000 }),
    ).toString('base64url');
    expect(verifyImpersonationToken(`${evilBody}.${sig}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = forge(
      { impersonatorId: 'o', targetUserId: 't', exp: Date.now() + 10_000 },
      'attacker-secret',
    );
    expect(verifyImpersonationToken(token)).toBeNull();
  });

  it('rejects an expired token (valid signature, past exp)', () => {
    const token = forge({ impersonatorId: 'o', targetUserId: 't', exp: Date.now() - 1 });
    expect(verifyImpersonationToken(token)).toBeNull();
  });

  it('rejects malformed input and fails closed without a secret', () => {
    expect(verifyImpersonationToken(undefined)).toBeNull();
    expect(verifyImpersonationToken('')).toBeNull();
    expect(verifyImpersonationToken('no-dot')).toBeNull();
    const token = signImpersonationToken('o', 't');
    delete process.env.NEXTAUTH_SECRET;
    expect(verifyImpersonationToken(token)).toBeNull();
    expect(() => signImpersonationToken('o', 't')).toThrow();
  });

  it('reads the cookie value from a Cookie header', () => {
    const token = signImpersonationToken('o', 't');
    const header = `foo=bar; ${IMPERSONATION_COOKIE}=${encodeURIComponent(token)}; baz=qux`;
    expect(readImpersonationCookie(header)).toBe(token);
    expect(readImpersonationCookie('other=1')).toBeNull();
    expect(readImpersonationCookie(null)).toBeNull();
  });
});
