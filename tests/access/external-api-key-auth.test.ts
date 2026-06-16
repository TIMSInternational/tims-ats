import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hashApiKey, extractBearerToken, activeApiKeyWhere } from '../../packages/api/src/lib/api-key';

describe('api-key crypto helpers', () => {
  it('hashApiKey is SHA-256 hex and matches the createApiKey formula', () => {
    const raw = 'tims_prod_deadbeef';
    const expected = createHash('sha256').update(raw).digest('hex');
    expect(hashApiKey(raw)).toBe(expected);
    expect(hashApiKey(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashApiKey is deterministic and differs per input', () => {
    expect(hashApiKey('a')).toBe(hashApiKey('a'));
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });

  it('extractBearerToken returns the token for a well-formed header', () => {
    const h = new Headers({ authorization: 'Bearer tims_prod_abc123' });
    expect(extractBearerToken(h)).toBe('tims_prod_abc123');
  });

  it('extractBearerToken is case-insensitive on the scheme and trims', () => {
    expect(extractBearerToken(new Headers({ authorization: 'bearer  tok ' }))).toBe('tok');
    expect(extractBearerToken(new Headers({ authorization: 'BEARER tok' }))).toBe('tok');
  });

  it('extractBearerToken returns null for missing/malformed/empty headers', () => {
    expect(extractBearerToken(new Headers())).toBeNull();
    expect(extractBearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull();
    expect(extractBearerToken(new Headers({ authorization: 'Bearer' }))).toBeNull();
    expect(extractBearerToken(new Headers({ authorization: 'Bearer    ' }))).toBeNull();
    expect(extractBearerToken(new Headers({ authorization: 'tims_prod_abc' }))).toBeNull();
  });

  it('extractBearerToken rejects absurdly long headers (defense-in-depth)', () => {
    const huge = 'Bearer ' + 'a'.repeat(5000);
    expect(extractBearerToken(new Headers({ authorization: huge }))).toBeNull();
    // A normal-length token still works (well under the cap).
    expect(extractBearerToken(new Headers({ authorization: 'Bearer ' + 'a'.repeat(73) }))).toBe('a'.repeat(73));
  });

  it('activeApiKeyWhere fails closed on revocation and expiry (null expiry = never expires)', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const where = activeApiKeyWhere('hash123', now);
    expect(where.keyHash).toBe('hash123');
    expect(where.revokedAt).toBeNull();
    // expiresAt: null (never expires) OR in the future
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gte: now } }]);
  });
});

describe('external-auth repository', () => {
  it('findActiveApiKeyByHash queries with the fail-closed active where + minimal select', async () => {
    vi.resetModules();
    const findFirst = vi.fn().mockResolvedValue({
      id: 'key-1', organizationId: 'org-1', scopes: ['assessment:read'],
    });
    vi.doMock('@tims/db', () => ({ db: {
      apiKey: { findFirst, update: vi.fn() },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org-1' }) },
    } }));
    const { findActiveApiKeyByHash } = await import(
      '../../packages/api/src/repositories/external-auth.repository'
    );
    const now = new Date('2026-06-15T00:00:00Z');
    const row = await findActiveApiKeyByHash('hash123', now);
    expect(row).toEqual({ id: 'key-1', organizationId: 'org-1', scopes: ['assessment:read'] });
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where.keyHash).toBe('hash123');
    expect(arg.where.revokedAt).toBeNull();
    expect(arg.where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gte: now } }]);
    // Never selects keyHash back out.
    expect(arg.select).toMatchObject({ id: true, organizationId: true, scopes: true });
    expect(arg.select.keyHash).toBeUndefined();
    vi.doUnmock('@tims/db');
  });

  it('findActiveApiKeyByHash fails closed when the owning organization is inactive/deleted', async () => {
    vi.resetModules();
    const apiFindFirst = vi.fn().mockResolvedValue({ id: 'key-1', organizationId: 'org-1', scopes: [] });
    const orgFindFirst = vi.fn().mockResolvedValue(null); // suspended/deleted org
    vi.doMock('@tims/db', () => ({ db: {
      apiKey: { findFirst: apiFindFirst, update: vi.fn() },
      organization: { findFirst: orgFindFirst },
    } }));
    const { findActiveApiKeyByHash } = await import('../../packages/api/src/repositories/external-auth.repository');
    const row = await findActiveApiKeyByHash('hash123', new Date('2026-06-15T00:00:00Z'));
    expect(row).toBeNull();
    expect(orgFindFirst).toHaveBeenCalled();
    vi.doUnmock('@tims/db');
  });
});

const REPO_ROOT = join(__dirname, '../..');
const readSrc = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

describe('createApiKey reuses the shared hash (no drift)', () => {
  it('integration.ts imports hashApiKey and no longer inlines createHash', () => {
    const INTEGRATION = readSrc('packages/api/src/routers/integration.ts');
    expect(INTEGRATION).toMatch(/hashApiKey/);
    expect(INTEGRATION).not.toMatch(/createHash\(['"]sha256['"]\)/);
  });
});

describe('resolveApiKeyPrincipal', () => {
  async function load(findResult: unknown) {
    vi.resetModules();
    const findFirst = vi.fn().mockResolvedValue(findResult);
    const update = vi.fn().mockResolvedValue({});
    vi.doMock('@tims/db', () => ({ db: {
      apiKey: { findFirst, update },
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o' }) },
    } }));
    const mod = await import('../../packages/api/src/access/external-auth');
    return { mod, findFirst, update };
  }

  it('returns a principal for a valid key with a clean string[] scopes', async () => {
    const { mod } = await load({ id: 'key-1', organizationId: 'org-1', scopes: ['assessment:read'] });
    const headers = new Headers({ authorization: 'Bearer tims_prod_valid' });
    const principal = await mod.resolveApiKeyPrincipal(headers, new Date());
    expect(principal).toEqual({ apiKeyId: 'key-1', organizationId: 'org-1', scopes: ['assessment:read'] });
    vi.doUnmock('@tims/db');
  });

  it('treats an empty scopes array as a valid unrestricted key', async () => {
    const { mod } = await load({ id: 'key-1', organizationId: 'org-1', scopes: [] });
    const principal = await mod.resolveApiKeyPrincipal(new Headers({ authorization: 'Bearer tims_prod_x' }), new Date());
    expect(principal).toEqual({ apiKeyId: 'key-1', organizationId: 'org-1', scopes: [] });
    vi.doUnmock('@tims/db');
  });

  it('FAILS CLOSED on malformed scopes (non-array or non-string elements)', async () => {
    for (const bad of [null, {}, 'assessment:read', 123, [123], ['ok', 7]]) {
      const { mod } = await load({ id: 'key-1', organizationId: 'org-1', scopes: bad });
      const principal = await mod.resolveApiKeyPrincipal(new Headers({ authorization: 'Bearer tims_prod_x' }), new Date());
      expect(principal).toBeNull();
      vi.doUnmock('@tims/db');
    }
  });

  it('returns null when no Authorization header is present (never queries db)', async () => {
    const { mod, findFirst } = await load(null);
    const principal = await mod.resolveApiKeyPrincipal(new Headers(), new Date());
    expect(principal).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    vi.doUnmock('@tims/db');
  });

  it('returns null when the key is not found / expired / revoked (finder returns null)', async () => {
    const { mod } = await load(null);
    const headers = new Headers({ authorization: 'Bearer tims_prod_gone' });
    expect(await mod.resolveApiKeyPrincipal(headers, new Date())).toBeNull();
    vi.doUnmock('@tims/db');
  });

  it('hashes the raw token before lookup (never queries by the raw key)', async () => {
    const { mod, findFirst } = await load({ id: 'k', organizationId: 'o', scopes: [] });
    await mod.resolveApiKeyPrincipal(new Headers({ authorization: 'Bearer tims_prod_secret' }), new Date());
    const where = findFirst.mock.calls[0][0].where;
    expect(where.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(where.keyHash).not.toContain('secret');
    vi.doUnmock('@tims/db');
  });

  it('buildExternalAccessUser yields a non-platform external principal keyed on the key id', async () => {
    const { mod } = await load(null);
    const user = mod.buildExternalAccessUser({ apiKeyId: 'key-1', organizationId: 'org-1', scopes: [] });
    expect(user).toEqual({ id: 'key-1', organizationId: 'org-1', roles: ['external'], isPlatformOwner: false });
    vi.doUnmock('@tims/db');
  });
});

describe('context type carries optional externalAuth', () => {
  it('TRPCContext declares externalAuth (optional) decoupled from staff user', () => {
    const CONTEXT = readSrc('packages/api/src/context.ts');
    expect(CONTEXT).toMatch(/externalAuth\??:/);
    expect(CONTEXT).toMatch(/apiKeyId:\s*string/);
  });
});

describe('externalProcedure boundary (trpc.ts)', () => {
  const TRPC = readSrc('packages/api/src/trpc.ts');

  it('requireApiKey resolves the principal and throws UNAUTHORIZED when absent', () => {
    expect(TRPC).toMatch(/requireApiKey\s*=\s*t\.middleware/);
    expect(TRPC).toMatch(/resolveApiKeyPrincipal\(\s*ctx\.headers/);
    expect(TRPC).toMatch(/code:\s*'UNAUTHORIZED'/);
  });

  it('externalProcedure is built from publicProcedure (rate-limited), NOT protectedProcedure', () => {
    const line = TRPC.split('\n').find((l) => l.includes('export const externalProcedure'));
    expect(line).toBeTruthy();
    expect(line).toContain('publicProcedure');
    expect(line).not.toContain('protectedProcedure');
  });

  it('establishes the key org as tenant context via runWithTenant', () => {
    expect(TRPC).toMatch(/runWithTenant\(\s*principal\.organizationId/);
  });

  it('touches lastUsedAt (fire-and-forget) after a successful auth', () => {
    expect(TRPC).toMatch(/touchApiKeyLastUsed\(/);
  });

  it('externalPermissionProcedure honors scopes[] as a narrowing filter and builds ctx.access', () => {
    expect(TRPC).toMatch(/externalPermissionProcedure/);
    expect(TRPC).toMatch(/buildAccessForUser\(/);
    expect(TRPC).toMatch(/requiredScope/);
    expect(TRPC).toMatch(/code:\s*'FORBIDDEN'/);
  });

  it('rate-limits per api key id (defense in depth atop the per-IP publicProcedure limit)', () => {
    expect(TRPC).toMatch(/checkRateLimit\(\s*`apikey:\$\{principal\.apiKeyId\}`/);
    expect(TRPC).toMatch(/getRateLimitCategory\(\s*path/);
  });
});
