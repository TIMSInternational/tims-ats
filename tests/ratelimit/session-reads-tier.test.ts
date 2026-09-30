import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// F7: auth.getSessionInfo / auth.getImpersonationStatus fire on EVERY staff page load. They used to
// be categorized into the strict `auth` tier (10 req / 5 min, meant for credential attempts), so a
// normal user got 429s after ~4-5 page views. They now take the `query` tier; auth MUTATIONS keep
// the strict tier. Exercised end-to-end through checkRateLimit on the in-memory fallback (no
// Upstash env), which is the path local dev and any Upstash-less deploy takes.

async function loadLimiter() {
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  return import('../../packages/api/src/middleware/rate-limit');
}

// Mirrors withRateLimit in packages/api/src/trpc.ts: category from path+type, then checkRateLimit.
async function call(
  mod: Awaited<ReturnType<typeof loadLimiter>>,
  userId: string,
  path: string,
  type: 'query' | 'mutation',
): Promise<void> {
  await mod.checkRateLimit(userId, mod.getRateLimitCategory(path, type));
}

describe('F7 — session reads do not consume the credential (auth) tier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('20 page-equivalent loads (getSessionInfo + getImpersonationStatus each) within a minute all succeed', async () => {
    const mod = await loadLimiter();
    for (let page = 0; page < 20; page++) {
      await expect(call(mod, 'user-pages', 'auth.getSessionInfo', 'query')).resolves.toBeUndefined();
      await expect(call(mod, 'user-pages', 'auth.getImpersonationStatus', 'query')).resolves.toBeUndefined();
      vi.advanceTimersByTime(2_000); // 20 pages over 40s — well inside one minute
    }
  });

  it('auth mutations are still limited at 10 per 5 minutes', async () => {
    const mod = await loadLimiter();
    for (let i = 0; i < 10; i++) {
      await expect(call(mod, 'user-creds', 'auth.login', 'mutation')).resolves.toBeUndefined();
    }
    await expect(call(mod, 'user-creds', 'auth.login', 'mutation')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    // Still blocked just before the 5-minute window closes, released after it.
    vi.advanceTimersByTime(4 * 60_000);
    await expect(call(mod, 'user-creds', 'auth.login', 'mutation')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    vi.advanceTimersByTime(60_001);
    await expect(call(mod, 'user-creds', 'auth.login', 'mutation')).resolves.toBeUndefined();
  });

  it('session reads do not drain the auth-mutation budget (separate buckets)', async () => {
    const mod = await loadLimiter();
    for (let i = 0; i < 40; i++) await call(mod, 'user-mixed', 'auth.getSessionInfo', 'query');
    for (let i = 0; i < 10; i++) {
      await expect(call(mod, 'user-mixed', 'auth.login', 'mutation')).resolves.toBeUndefined();
    }
  });

  it('session reads are still bounded by the query tier (100 / min)', async () => {
    const mod = await loadLimiter();
    for (let i = 0; i < 100; i++) await call(mod, 'user-flood', 'auth.getSessionInfo', 'query');
    await expect(call(mod, 'user-flood', 'auth.getSessionInfo', 'query')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('categorizes auth reads as query and auth mutations as auth', async () => {
    const mod = await loadLimiter();
    expect(mod.getRateLimitCategory('auth.getSessionInfo', 'query')).toBe('query');
    expect(mod.getRateLimitCategory('auth.getImpersonationStatus', 'query')).toBe('query');
    expect(mod.getRateLimitCategory('auth.login', 'mutation')).toBe('auth');
  });
});
