import { describe, expect, it } from 'vitest';
import { base32Decode, hotp, totp } from '../../e2e/lib/totp';

/**
 * The E2E stack signs MFA personas in with a TOTP code computed here, so this helper must agree
 * with every RFC-conformant verifier (GoTrue included). The vectors are the published ones:
 * RFC 4226 appendix D (HOTP) and RFC 6238 appendix B (TOTP, SHA-1 rows).
 */

// RFC 4226 / RFC 6238 SHA-1 test secret: the ASCII string "12345678901234567890".
const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
// The same 20 bytes, base32-encoded (the form Supabase returns from an MFA enroll). Public RFC
// test material, not a credential.
const RFC_SEED_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const at = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

describe('hotp: RFC 4226 appendix D vectors', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(expected.map((code, counter) => [counter, code] as const))('counter %i -> %s', (counter, code) => {
    expect(hotp(RFC_KEY, counter)).toBe(code);
  });
});

describe('totp: RFC 6238 appendix B SHA-1 vectors', () => {
  const vectors: ReadonlyArray<readonly [number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('T=%i -> %s (8 digits, as published)', (t, code) => {
    expect(totp(RFC_KEY, { time: at(t), digits: 8 })).toBe(code);
  });

  it.each(vectors)('T=%i -> last 6 digits of %s (default 6 digits)', (t, code) => {
    expect(totp(RFC_KEY, { time: at(t) })).toBe(code.slice(-6));
  });

  it('keeps leading zeros (T=1111111109 is 081804, not 81804)', () => {
    expect(totp(RFC_KEY, { time: at(1111111109) })).toBe('081804');
  });
});

describe('totp: time steps', () => {
  it('uses a 30-second step by default: T=30 and T=59 share a code, T=60 does not', () => {
    const a = totp(RFC_KEY, { time: at(30) });
    expect(totp(RFC_KEY, { time: at(59) })).toBe(a);
    expect(totp(RFC_KEY, { time: at(60) })).not.toBe(a);
  });

  it('equals hotp at counter floor(T / step)', () => {
    expect(totp(RFC_KEY, { time: at(1234567890) })).toBe(hotp(RFC_KEY, Math.floor(1234567890 / 30)));
    expect(totp(RFC_KEY, { time: at(600), stepSeconds: 60 })).toBe(hotp(RFC_KEY, 10));
  });

  it('ignores sub-second time (999 ms into second 59 is still step 1)', () => {
    expect(totp(RFC_KEY, { time: new Date(59_999) })).toBe('287082');
  });

  it('defaults to the current time', () => {
    const before = totp(RFC_KEY, { time: new Date() });
    const now = totp(RFC_KEY);
    const after = totp(RFC_KEY, { time: new Date() });
    expect([before, after]).toContain(now);
  });
});

describe('totp: base32 secrets', () => {
  it('accepts the base32 form of the RFC key', () => {
    expect(totp(RFC_SEED_BASE32, { time: at(59), digits: 8 })).toBe('94287082');
  });

  it.each([
    ['lower case', RFC_SEED_BASE32.toLowerCase()],
    ['grouped with spaces', RFC_SEED_BASE32.replace(/(.{4})/g, '$1 ').trim()],
  ])('normalises a secret written in %s', (_label, secret) => {
    expect(base32Decode(secret).equals(RFC_KEY)).toBe(true);
  });

  it('accepts = padding (base32 of "1234" is GEZDGNA=)', () => {
    expect(base32Decode('GEZDGNA=').toString('ascii')).toBe('1234');
    expect(base32Decode('GEZDGNA').toString('ascii')).toBe('1234');
  });

  it('decodes to the exact RFC bytes', () => {
    expect(base32Decode(RFC_SEED_BASE32).equals(RFC_KEY)).toBe(true);
  });

  it.each(['GEZDGNBV1', 'GEZDGNBV8', 'GEZDGNBV0', 'GEZD-GNBV', 'GEZDGNBVÁ'])(
    'rejects a character outside the RFC 4648 alphabet: %s',
    (bad) => {
      expect(() => base32Decode(bad)).toThrow(/base32/i);
    },
  );

  it('rejects an empty secret', () => {
    expect(() => base32Decode('   ')).toThrow(/empty/i);
    expect(() => totp('', { time: at(59) })).toThrow(/empty/i);
  });
});

describe('hotp / totp: input bounds', () => {
  it.each([5, 9, 0, 6.5])('rejects digits=%s (only 6, 7 or 8 are valid)', (digits) => {
    expect(() => hotp(RFC_KEY, 1, digits)).toThrow(/digits/i);
    expect(() => totp(RFC_KEY, { time: at(59), digits })).toThrow(/digits/i);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects counter %s', (counter) => {
    expect(() => hotp(RFC_KEY, counter)).toThrow(/counter/i);
  });

  it('rejects a negative bigint counter with the counter error, not a Buffer RangeError', () => {
    expect(() => hotp(RFC_KEY, -1n)).toThrow(/counter must be a non-negative integer/i);
  });

  it('rejects a time before the Unix epoch and an invalid Date', () => {
    expect(() => totp(RFC_KEY, { time: new Date(-1000) })).toThrow(/time/i);
    expect(() => totp(RFC_KEY, { time: new Date(Number.NaN) })).toThrow(/time/i);
  });

  it.each([0, -30, 1.5])('rejects stepSeconds=%s', (stepSeconds) => {
    expect(() => totp(RFC_KEY, { time: at(59), stepSeconds })).toThrow(/step/i);
  });

  it('rejects an empty key', () => {
    expect(() => hotp(Buffer.alloc(0), 1)).toThrow(/empty/i);
  });

  it('handles counters above 2^32 (8-byte big-endian counter, not 4)', () => {
    const big = 2 ** 33 + 7;
    expect(hotp(RFC_KEY, big)).toBe(hotp(RFC_KEY, BigInt(big)));
    expect(hotp(RFC_KEY, big)).not.toBe(hotp(RFC_KEY, 7));
  });
});
