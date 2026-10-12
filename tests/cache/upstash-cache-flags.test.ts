import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// PR #358 review fix: the Upstash REST credentials exist for the rate limiter. Setting them
// must NOT silently move the AI response cache or the permission cache to Upstash (a
// subprocessor/data decision). Each cache needs its own explicit flag, default OFF.

// Mock the ESM entry ("import": "./nodejs.mjs") that the source modules actually load; the
// bare package directory resolves to the CJS `main` and would not intercept them.
const API_REDIS = resolve(__dirname, '../../packages/api/node_modules/@upstash/redis/nodejs.mjs');
const AI_REDIS = resolve(__dirname, '../../packages/ai/node_modules/@upstash/redis/nodejs.mjs');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(API_REDIS);
  vi.doUnmock(AI_REDIS);
  vi.resetModules();
});

function fakeRedis(constructed: string[], label: string) {
  return () => ({
    Redis: class {
      constructor() {
        constructed.push(label);
      }
      get() {
        return Promise.resolve(null);
      }
      set() {
        return Promise.resolve('OK');
      }
      keys() {
        return Promise.resolve([]);
      }
      del() {
        return Promise.resolve(0);
      }
    },
  });
}

function stubCredentials() {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.test');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-test-token');
}

describe('permission cache (packages/api/src/lib/cache.ts)', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'stays in memory with Upstash credentials set and flag=%s',
    async (flag) => {
      vi.resetModules();
      stubCredentials();
      vi.stubEnv('PERMISSION_CACHE_UPSTASH_ENABLED', flag ?? '');
      const constructed: string[] = [];
      vi.doMock(API_REDIS, fakeRedis(constructed, 'api'));
      const mod = await import('../../packages/api/src/lib/cache');
      expect(mod.isPermissionCacheUpstashEnabled()).toBe(false);
      expect(constructed).toEqual([]);
      await mod.cacheSet('k', { a: 1 }, 60);
      expect(await mod.cacheGet('k')).toEqual({ a: 1 }); // served from memory
    },
  );

  it('uses Upstash only when PERMISSION_CACHE_UPSTASH_ENABLED=true', async () => {
    vi.resetModules();
    stubCredentials();
    vi.stubEnv('PERMISSION_CACHE_UPSTASH_ENABLED', 'true');
    const constructed: string[] = [];
    vi.doMock(API_REDIS, fakeRedis(constructed, 'api'));
    const mod = await import('../../packages/api/src/lib/cache');
    expect(mod.isPermissionCacheUpstashEnabled()).toBe(true);
    expect(constructed).toEqual(['api']);
  });

  it('the AI cache flag does not enable the permission cache', async () => {
    vi.resetModules();
    stubCredentials();
    vi.stubEnv('AI_CACHE_UPSTASH_ENABLED', 'true');
    vi.stubEnv('PERMISSION_CACHE_UPSTASH_ENABLED', '');
    const constructed: string[] = [];
    vi.doMock(API_REDIS, fakeRedis(constructed, 'api'));
    await import('../../packages/api/src/lib/cache');
    expect(constructed).toEqual([]);
  });
});

describe('AI response cache (packages/ai/src/cache.ts)', () => {
  it.each([undefined, '', 'false', 'yes'])('stays in memory with Upstash credentials set and flag=%s', async (flag) => {
    vi.resetModules();
    stubCredentials();
    vi.stubEnv('AI_CACHE_UPSTASH_ENABLED', flag ?? '');
    const constructed: string[] = [];
    vi.doMock(AI_REDIS, fakeRedis(constructed, 'ai'));
    const mod = await import('../../packages/ai/src/cache');
    expect(mod.isAiCacheUpstashEnabled()).toBe(false);
    expect(constructed).toEqual([]);
    await mod.setCached('vacancy-writer', 'org-a', { t: 1 }, { d: 'x' }, 60);
    expect(await mod.getCached('vacancy-writer', 'org-a', { t: 1 }, 60)).toEqual({ d: 'x' });
  });

  it('uses Upstash only when AI_CACHE_UPSTASH_ENABLED=true', async () => {
    vi.resetModules();
    stubCredentials();
    vi.stubEnv('AI_CACHE_UPSTASH_ENABLED', 'true');
    const constructed: string[] = [];
    vi.doMock(AI_REDIS, fakeRedis(constructed, 'ai'));
    const mod = await import('../../packages/ai/src/cache');
    expect(mod.isAiCacheUpstashEnabled()).toBe(true);
    expect(constructed).toEqual(['ai']);
  });

  it('the permission cache flag does not enable the AI cache', async () => {
    vi.resetModules();
    stubCredentials();
    vi.stubEnv('PERMISSION_CACHE_UPSTASH_ENABLED', 'true');
    vi.stubEnv('AI_CACHE_UPSTASH_ENABLED', '');
    const constructed: string[] = [];
    vi.doMock(AI_REDIS, fakeRedis(constructed, 'ai'));
    await import('../../packages/ai/src/cache');
    expect(constructed).toEqual([]);
  });
});
