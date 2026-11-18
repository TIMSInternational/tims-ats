import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  cacheGet, cacheSet, cacheInvalidatePrefix,
} from '../../packages/api/src/lib/cache';

// No UPSTASH_* env in CI/dev → exercises the in-memory fallback deterministically.
// Authorization keys (tims:perm:, tims:access:, ...) never live in that fallback (see
// upstash-cache-flags.test.ts), so prefix invalidation is exercised with KPI keys here and
// invalidatePermissionCache against a Map-backed stand-in for the shared store.

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
    await cacheSet('tims:kpis:orgX:a', 1, 60);
    await cacheSet('tims:kpis:orgX:b', 2, 60);
    await cacheSet('tims:kpis:orgY:a', 3, 60);
    await cacheInvalidatePrefix('tims:kpis:orgX:');
    expect(await cacheGet('tims:kpis:orgX:a')).toBeNull();
    expect(await cacheGet('tims:kpis:orgX:b')).toBeNull();
    expect(await cacheGet('tims:kpis:orgY:a')).toBe(3);
  });
});

const API_REDIS = resolve(__dirname, '../../packages/api/node_modules/@upstash/redis/nodejs.mjs');

describe('invalidatePermissionCache', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock(API_REDIS);
    vi.resetModules();
  });

  it('clears both legacy tims:perm: and scoped tims:access: entries, only for that org', async () => {
    vi.resetModules();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-test-token');
    vi.stubEnv('PERMISSION_CACHE_UPSTASH_ENABLED', 'true');
    const store = new Map<string, string>();
    vi.doMock(API_REDIS, () => ({
      Redis: class {
        get(key: string) {
          return Promise.resolve(store.get(key) ?? null);
        }
        set(key: string, value: string) {
          store.set(key, value);
          return Promise.resolve('OK');
        }
        keys(pattern: string) {
          const prefix = pattern.replace(/\*$/, '');
          return Promise.resolve([...store.keys()].filter((k) => k.startsWith(prefix)));
        }
        del(...keys: string[]) {
          keys.forEach((k) => store.delete(k));
          return Promise.resolve(keys.length);
        }
      },
    }));
    const { cacheGet, cacheSet, invalidatePermissionCache } = await import('../../packages/api/src/lib/cache');
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
