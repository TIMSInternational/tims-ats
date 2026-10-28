import { afterEach, describe, expect, it, vi } from 'vitest';

// With Upstash configured, a limiter TIMEOUT comes back as `{ success: true, reason: 'timeout' }`. The
// CV-upload tiers must treat that as a rejection (fail closed); the existing tiers keep their behaviour.
// The Upstash clients are faked at their resolved location (rate-limit.ts imports packages/api's copies).

const limitMock = vi.fn();
vi.mock('../../packages/api/node_modules/@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = vi.fn(() => ({}));
    static fixedWindow = vi.fn(() => ({}));
    limit = limitMock;
  }
  return { Ratelimit };
});
vi.mock('../../packages/api/node_modules/@upstash/redis', () => ({ Redis: class {} }));

async function loadLimiter() {
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.example.test');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  return import('../../packages/api/src/middleware/rate-limit');
}

describe('CV-upload rate-limit tiers fail closed on an Upstash timeout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    limitMock.mockReset();
  });

  it.each(['cvUpload', 'cvUploadVacancy'] as const)('%s rejects a timeout result', async (category) => {
    const mod = await loadLimiter();
    limitMock.mockResolvedValue({ success: true, reason: 'timeout', reset: 0 });
    await expect(mod.checkRateLimit('ip:203.0.113.9', category)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(limitMock).toHaveBeenCalledWith('ip:203.0.113.9');
  });

  it('a normal success still passes on the CV-upload tier', async () => {
    const mod = await loadLimiter();
    limitMock.mockResolvedValue({ success: true, reset: 0 });
    await expect(mod.checkRateLimit('ip:203.0.113.9', 'cvUpload')).resolves.toBeUndefined();
  });

  it('the existing mutation tier keeps its timeout behaviour (unchanged by this tier)', async () => {
    const mod = await loadLimiter();
    limitMock.mockResolvedValue({ success: true, reason: 'timeout', reset: 0 });
    await expect(mod.checkRateLimit('user-1', 'mutation')).resolves.toBeUndefined();
  });
});
