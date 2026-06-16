import { hashApiKey, extractBearerToken } from '../lib/api-key';
import { findActiveApiKeyByHash } from '../repositories/external-auth.repository';
import type { AccessUser } from './build';

/** The resolved API-key principal. The key IS the principal — there is no User row. */
export interface ExternalPrincipal {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}

/**
 * Parse the Json `scopes` column. Returns a clean string[] for a valid array (an
 * empty array means "no per-key narrowing" — an intentional, valid state). Returns
 * null for a MALFORMED value (not an array, or an array containing a non-string) so
 * the caller can FAIL CLOSED — a corrupted scopes value must never silently broaden
 * a key to the full role grant.
 */
function parseScopes(scopes: unknown): string[] | null {
  if (!Array.isArray(scopes)) return null;
  if (!scopes.every((s) => typeof s === 'string')) return null;
  return scopes as string[];
}

/**
 * Resolve the external principal from the request headers, or null (fail closed).
 * Reads the bearer token from the Authorization header ONLY, hashes it, and looks
 * up an ACTIVE key. No header → no db query. Not-found/expired/revoked → null.
 * Malformed scopes (non-array or non-string elements) → null (fail closed).
 */
export async function resolveApiKeyPrincipal(
  headers: Headers,
  now: Date,
): Promise<ExternalPrincipal | null> {
  const token = extractBearerToken(headers);
  if (!token) return null;
  const row = await findActiveApiKeyByHash(hashApiKey(token), now);
  if (!row) return null;
  const scopes = parseScopes(row.scopes);
  if (scopes === null) return null; // malformed scopes → fail closed (deny auth)
  return { apiKeyId: row.id, organizationId: row.organizationId, scopes };
}

/**
 * Map a principal to the AccessUser shape buildAccessForUser expects. The key id is
 * the principal id (used as audit actorId + rate-limit key). roles=['external'];
 * never platform owner.
 */
export function buildExternalAccessUser(principal: ExternalPrincipal): AccessUser {
  return {
    id: principal.apiKeyId,
    organizationId: principal.organizationId,
    roles: ['external'],
    isPlatformOwner: false,
  };
}
