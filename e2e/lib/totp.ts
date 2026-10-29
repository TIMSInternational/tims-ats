import { createHmac } from 'node:crypto';

/**
 * RFC 4226 (HOTP) and RFC 6238 (TOTP, HMAC-SHA-1) for E2E MFA sign-ins against the local stack.
 * Pure and dependency-free (node:crypto only), so root vitest can pin it to the published vectors.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode an RFC 4648 base32 secret. Case-insensitive; spaces and trailing `=` padding are ignored. */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  if (clean.length === 0) throw new Error('[totp] base32 secret is empty');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = BASE32_ALPHABET.indexOf(ch);
    if (value === -1) throw new Error('[totp] invalid base32 character in secret');
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function assertDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error(`[totp] digits must be 6, 7 or 8 (got ${digits})`);
  }
}

/** RFC 4226 HOTP with an 8-byte big-endian counter and dynamic truncation. */
export function hotp(key: Buffer, counter: number | bigint, digits = 6): string {
  if (key.length === 0) throw new Error('[totp] HMAC key is empty');
  assertDigits(digits);
  let big: bigint;
  if (typeof counter === 'bigint') {
    if (counter < 0n) throw new Error('[totp] counter must be a non-negative integer');
    big = counter;
  } else {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error('[totp] counter must be a non-negative integer');
    }
    big = BigInt(counter);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(big);
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  /** Defaults to now. */
  time?: Date;
  /** Defaults to 30. */
  stepSeconds?: number;
  /** Defaults to 6. */
  digits?: number;
}

/** RFC 6238 TOTP (SHA-1). `key` is raw bytes or the base32 secret an MFA enroll returns. */
export function totp(key: Buffer | string, options: TotpOptions = {}): string {
  const { time = new Date(), stepSeconds = 30, digits = 6 } = options;
  const bytes = typeof key === 'string' ? base32Decode(key) : key;
  const ms = time.getTime();
  if (!Number.isFinite(ms) || ms < 0) throw new Error('[totp] time must be a valid date at or after the Unix epoch');
  if (!Number.isInteger(stepSeconds) || stepSeconds <= 0) {
    throw new Error('[totp] stepSeconds must be a positive integer');
  }
  return hotp(bytes, Math.floor(Math.floor(ms / 1000) / stepSeconds), digits);
}
