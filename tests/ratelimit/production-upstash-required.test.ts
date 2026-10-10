import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

const UPSTASH_RATELIMIT = resolve(__dirname, '../../packages/api/node_modules/@upstash/ratelimit');
const UPSTASH_REDIS = resolve(__dirname, '../../packages/api/node_modules/@upstash/redis');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(UPSTASH_RATELIMIT);
  vi.doUnmock(UPSTASH_REDIS);
  vi.resetModules();
});

describe('rate-limit store configuration', () => {
  it('refuses per-instance memory counters in Vercel production', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    await expect(import('../../packages/api/src/middleware/rate-limit')).rejects.toThrow(
      'Production rate limiting requires shared Upstash Redis',
    );
  });

  it('rejects a half-configured Upstash store in any environment', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    await expect(import('../../packages/api/src/middleware/rate-limit')).rejects.toThrow(
      'Rate limiting requires both Upstash REST environment variables',
    );
  });

  it('allows local fallback and a fully configured production store', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    await expect(import('../../packages/api/src/middleware/rate-limit')).resolves.toHaveProperty('checkRateLimit');

    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-test-token');
    await expect(import('../../packages/api/src/middleware/rate-limit')).resolves.toHaveProperty('checkRateLimit');
  });

  it('fails closed when the shared limiter times out instead of accepting SDK fallback success', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-test-token');
    vi.doMock(UPSTASH_REDIS, () => ({ Redis: class {} }));
    vi.doMock(UPSTASH_RATELIMIT, () => {
      class Ratelimit {
        limit() {
          return Promise.resolve({ success: true, reason: 'timeout', reset: Date.now() + 1000 });
        }
        static slidingWindow() {
          return {};
        }
        static fixedWindow() {
          return {};
        }
      }
      return { Ratelimit };
    });
    const { checkRateLimit } = await import('../../packages/api/src/middleware/rate-limit');
    await expect(checkRateLimit('synthetic-id', 'auth')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
