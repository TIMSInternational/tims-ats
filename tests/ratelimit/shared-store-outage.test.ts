import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// PR #358 review fix: an Upstash outage must not take the whole app down. Each shared
// limiter call is bounded to ~1s; on timeout/error the auth, AI and export tiers (and
// credential-like paths) fail CLOSED, every other tier fails OPEN to the per-instance
// memory limiter with a structured, PII-free warning.

const RATE_LIMIT = '../../packages/api/src/middleware/rate-limit';
const UPSTASH_RATELIMIT = resolve(__dirname, '../../packages/api/node_modules/@upstash/ratelimit');
const UPSTASH_REDIS = resolve(__dirname, '../../packages/api/node_modules/@upstash/redis');

type LimitFn = (id: string) => Promise<{ success: boolean; reason?: string; reset?: number }>;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock(UPSTASH_RATELIMIT);
  vi.doUnmock(UPSTASH_REDIS);
  vi.resetModules();
});

async function loadWithFakeUpstash(limit: LimitFn) {
  vi.resetModules();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.test');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-test-token');
  const timeouts: Array<number | undefined> = [];
  vi.doMock(UPSTASH_REDIS, () => ({ Redis: class {} }));
  vi.doMock(UPSTASH_RATELIMIT, () => {
    class Ratelimit {
      constructor(opts: { timeout?: number }) {
        timeouts.push(opts.timeout);
      }
      limit(id: string) {
        return limit(id);
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
  const mod = await import(RATE_LIMIT);
  // Same module graph as rate-limit.ts after resetModules, so this is the logger it uses.
  const { logger } = await import('@tims/shared');
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return { mod, warn, timeouts };
}

const never: LimitFn = () => new Promise(() => {});
const sdkTimeout: LimitFn = () => Promise.resolve({ success: true, reason: 'timeout', reset: Date.now() + 1000 });
const redisDown: LimitFn = () => Promise.reject(new Error('fetch failed https://fake.upstash.test'));

describe('shared limiter is bounded', () => {
  it('passes a ~1s timeout to every Upstash limiter instead of the 5s SDK default', async () => {
    const { mod, timeouts } = await loadWithFakeUpstash(never);
    expect(mod.SHARED_LIMIT_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
    expect(timeouts.length).toBeGreaterThanOrEqual(6); // 5 tiers + application-email cap
    for (const t of timeouts) expect(t).toBe(mod.SHARED_LIMIT_TIMEOUT_MS);
  });

  it('settles a hanging Redis call within the deadline (not after 5s)', async () => {
    vi.useFakeTimers();
    const { mod } = await loadWithFakeUpstash(never);
    let settled = false;
    const p = mod.checkRateLimit('user-1', 'query').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });
});

describe.each([
  ['hanging call (own deadline)', never],
  ['SDK timeout fallback', sdkTimeout],
  ['Redis error', redisDown],
] as const)('outage: %s', (_label, limit) => {
  it.each(['auth', 'ai', 'export'] as const)('fails CLOSED for the %s tier', async (category) => {
    vi.useFakeTimers();
    const { mod, warn } = await loadWithFakeUpstash(limit);
    const p = mod.checkRateLimit('user-1', category);
    const assertion = expect(p).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await assertion;
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ratelimit.shared_store_unavailable', category, mode: 'fail_closed' }),
      expect.any(String),
    );
  });

  it.each(['query', 'mutation'] as const)(
    'fails OPEN to the per-instance limiter for the %s tier',
    async (category) => {
      vi.useFakeTimers();
      const { mod, warn } = await loadWithFakeUpstash(limit);
      const p = mod.checkRateLimit('user-1', category);
      await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
      await expect(p).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ratelimit.shared_store_unavailable', category, mode: 'fail_open_memory' }),
        expect.any(String),
      );
    },
  );

  it('fails CLOSED for a credential-like path even in an ordinary tier', async () => {
    vi.useFakeTimers();
    const { mod } = await loadWithFakeUpstash(limit);
    expect(mod.isFailClosedPath('platform.acceptInvitation')).toBe(true);
    const p = mod.checkRateLimit('ip:203.0.113.9', 'mutation', { failClosed: true });
    const assertion = expect(p).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await assertion;
  });
});

describe('fail-open still limits per instance', () => {
  it('enforces the in-memory query limit while the shared store is down', async () => {
    const { mod } = await loadWithFakeUpstash(redisDown);
    for (let i = 0; i < 100; i++) await mod.checkRateLimit('user-flood', 'query');
    await expect(mod.checkRateLimit('user-flood', 'query')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

describe('outage log is observable but carries no PII and does not flood', () => {
  it('never logs the identifier or the raw error message, and throttles repeats', async () => {
    const { mod, warn } = await loadWithFakeUpstash(redisDown);
    await mod.checkRateLimit('user-secret-id', 'query');
    await mod.checkRateLimit('user-secret-id', 'query');
    await mod.checkRateLimit('ip:198.51.100.7', 'query');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('user-secret-id');
    expect(logged).not.toContain('198.51.100.7');
    expect(logged).not.toContain('fake.upstash.test');
    expect(warn.mock.calls[0]![0]).toMatchObject({ cause: 'error', errorName: 'Error' });
  });
});

describe('healthy shared store is unchanged', () => {
  it('allows on success and returns TOO_MANY_REQUESTS on a real deny', async () => {
    const limit = vi
      .fn<LimitFn>()
      .mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 })
      .mockResolvedValueOnce({ success: false, reset: Date.now() + 30_000 });
    const { mod, warn } = await loadWithFakeUpstash(limit);
    await expect(mod.checkRateLimit('user-1', 'auth')).resolves.toBeUndefined();
    await expect(mod.checkRateLimit('user-1', 'auth')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('isFailClosedPath', () => {
  it('covers invitation, password-reset and offer-signing token paths, case-insensitively', async () => {
    const { mod } = await loadWithFakeUpstash(never);
    for (const p of [
      'platform.acceptInvitation',
      'platform.getInvitationByToken',
      'platform.resetUserPassword',
      'offer.acceptByToken',
      'offer.declineByToken',
      'offer.getBySigningToken',
    ]) {
      expect(mod.isFailClosedPath(p)).toBe(true);
    }
    expect(mod.isFailClosedPath('candidate.list')).toBe(false);
    expect(mod.isFailClosedPath('auth.getSessionInfo')).toBe(false);
  });
});
