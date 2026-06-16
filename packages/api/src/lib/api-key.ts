import { createHash } from 'crypto';
import type { Prisma } from '@tims/db';

/**
 * SHA-256 hex digest of a raw API key. The SINGLE source of truth for the hash —
 * both createApiKey (store) and the external auth path (verify) call this, so the
 * two can never drift. Raw keys are high-entropy random tokens, so a fast hash is
 * appropriate (no need for a slow KDF; there is nothing to brute-force).
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Extract a bearer token from an Authorization header. Scheme is case-insensitive.
 * Returns null for any missing/malformed/empty value — callers MUST treat null as
 * "no credential" and fail closed. The token is read ONLY from headers, never input.
 */
export function extractBearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization');
  // Defense-in-depth: reject absurdly long headers before hashing/DB lookup. A real
  // key (`tims_<env>_<64-hex>`) is well under 100 chars; 2048 is a generous ceiling.
  if (!raw || raw.length > 2048) return null;
  const match = /^bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Prisma `where` for an ACTIVE key: matching hash, not revoked, and either no
 * expiry (null = never expires) or an expiry still in the future. This is the
 * fail-closed gate — an expired or revoked key never matches.
 */
export function activeApiKeyWhere(keyHash: string, now: Date): Prisma.ApiKeyWhereInput {
  return {
    keyHash,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
  };
}
