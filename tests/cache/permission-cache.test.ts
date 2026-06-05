import { describe, it, expect } from 'vitest';
import {
  cacheGet, cacheSet, cacheInvalidatePrefix,
  permissionCacheKey, getCachedPermission, setCachedPermission, invalidatePermissionCache,
} from '../../packages/api/src/lib/cache';

// No UPSTASH_* env in CI/dev → exercises the in-memory fallback deterministically.

describe('cache-aside layer', () => {
  it('round-trips a value under a positive TTL', async () => {
    await cacheSet('k1', { a: 1 }, 60);
    expect(await cacheGet<{ a: number }>('k1')).toEqual({ a: 1 });
  });

  it('returns null for a missing key', async () => {
    expect(await cacheGet('nope')).toBeNull();
  });

  it('ttl<=0 is a no-op write', async () => {
    await cacheSet('k0', 'x', 0);
    expect(await cacheGet('k0')).toBeNull();
  });

  it('invalidates by prefix', async () => {
    await cacheSet('tims:perm:orgX:a', true, 60);
    await cacheSet('tims:perm:orgX:b', false, 60);
    await cacheSet('tims:perm:orgY:a', true, 60);
    await cacheInvalidatePrefix('tims:perm:orgX:');
    expect(await cacheGet('tims:perm:orgX:a')).toBeNull();
    expect(await cacheGet('tims:perm:orgX:b')).toBeNull();
    expect(await cacheGet('tims:perm:orgY:a')).toBe(true);
  });
});

describe('permission cache', () => {
  it('builds a role-order-independent key', () => {
    expect(permissionCacheKey('org1', ['b', 'a'], 'candidate', 'read'))
      .toBe(permissionCacheKey('org1', ['a', 'b'], 'candidate', 'read'));
  });

  it('keys differ by org / module / action', () => {
    const base = permissionCacheKey('org1', ['recruiter'], 'candidate', 'read');
    expect(permissionCacheKey('org2', ['recruiter'], 'candidate', 'read')).not.toBe(base);
    expect(permissionCacheKey('org1', ['recruiter'], 'vacancy', 'read')).not.toBe(base);
    expect(permissionCacheKey('org1', ['recruiter'], 'candidate', 'update')).not.toBe(base);
  });

  it('caches both allow (true) and deny (false), distinct from a miss', async () => {
    await setCachedPermission('orgA', ['recruiter'], 'candidate', 'read', true);
    await setCachedPermission('orgA', ['recruiter'], 'candidate', 'delete', false);
    expect(await getCachedPermission('orgA', ['recruiter'], 'candidate', 'read')).toBe(true);
    expect(await getCachedPermission('orgA', ['recruiter'], 'candidate', 'delete')).toBe(false);
    expect(await getCachedPermission('orgA', ['recruiter'], 'candidate', 'create')).toBeNull();
  });

  it('invalidatePermissionCache clears only that org', async () => {
    await setCachedPermission('orgClear', ['hr_admin'], 'compensation', 'read', true);
    await setCachedPermission('orgKeep', ['hr_admin'], 'compensation', 'read', true);
    await invalidatePermissionCache('orgClear');
    expect(await getCachedPermission('orgClear', ['hr_admin'], 'compensation', 'read')).toBeNull();
    expect(await getCachedPermission('orgKeep', ['hr_admin'], 'compensation', 'read')).toBe(true);
  });
});
