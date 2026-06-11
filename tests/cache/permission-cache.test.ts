import { describe, it, expect } from 'vitest';
import {
  cacheGet, cacheSet, cacheInvalidatePrefix, invalidatePermissionCache,
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

describe('invalidatePermissionCache', () => {
  it('clears both legacy tims:perm: and scoped tims:access: entries, only for that org', async () => {
    await cacheSet('tims:perm:orgClear:hr_admin:compensation:read', true, 60);
    await cacheSet('tims:access:orgClear:hr_admin:compensation:read', { allowed: true }, 60);
    await cacheSet('tims:perm:orgKeep:hr_admin:compensation:read', true, 60);
    await cacheSet('tims:access:orgKeep:hr_admin:compensation:read', { allowed: true }, 60);
    await invalidatePermissionCache('orgClear');
    expect(await cacheGet('tims:perm:orgClear:hr_admin:compensation:read')).toBeNull();
    expect(await cacheGet('tims:access:orgClear:hr_admin:compensation:read')).toBeNull();
    expect(await cacheGet('tims:perm:orgKeep:hr_admin:compensation:read')).toBe(true);
    expect(await cacheGet('tims:access:orgKeep:hr_admin:compensation:read')).toEqual({ allowed: true });
  });
});
