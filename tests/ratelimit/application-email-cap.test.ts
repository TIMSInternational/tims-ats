import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

// #308 security fix: the unauthenticated apply form chooses the recipient of the
// "application received" email, so the platform caps it at ONE per address per 24h.
// Covers both the in-memory fallback (no Upstash env: local dev + tests) and the Upstash
// path (a fake Ratelimit), including the fail-closed timeout / error behaviour.

const RATE_LIMIT = '../../packages/api/src/middleware/rate-limit';
// pnpm hosts @upstash/* under packages/api only; mock them by that path so the ids match
// what rate-limit.ts resolves.
const UPSTASH_RATELIMIT = resolve(__dirname, '../../packages/api/node_modules/@upstash/ratelimit');
const UPSTASH_REDIS = resolve(__dirname, '../../packages/api/node_modules/@upstash/redis');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock(UPSTASH_RATELIMIT);
  vi.doUnmock(UPSTASH_REDIS);
  vi.resetModules();
});

async function loadInMemory() {
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  return import(RATE_LIMIT);
}

describe('consumeApplicationEmailQuota — in-memory fallback', () => {
  it('allows one send per address per 24h, case-insensitively, independent per address', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const { consumeApplicationEmailQuota } = await loadInMemory();

    expect(await consumeApplicationEmailQuota('ana@example.com')).toBe(true);
    expect(await consumeApplicationEmailQuota(' ANA@Example.com ')).toBe(false);
    expect(await consumeApplicationEmailQuota('luis@example.com')).toBe(true);

    vi.setSystemTime(new Date('2026-10-01T11:59:59Z'));
    expect(await consumeApplicationEmailQuota('ana@example.com')).toBe(false);
    vi.setSystemTime(new Date('2026-10-01T12:00:01Z'));
    expect(await consumeApplicationEmailQuota('ana@example.com')).toBe(true);
  });
});

describe('consumeApplicationEmailQuota — Upstash path', () => {
  async function loadWithFakeUpstash(limit: (id: string) => Promise<{ success: boolean; reason?: string }>) {
    vi.resetModules();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token');
    const prefixes: string[] = [];
    vi.doMock(UPSTASH_REDIS, () => ({ Redis: class {} }));
    vi.doMock(UPSTASH_RATELIMIT, () => {
      class Ratelimit {
        constructor(opts: { prefix: string }) {
          prefixes.push(opts.prefix);
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
    return { mod, prefixes };
  }

  it('keys the limiter on sha256(lowercased address), never the raw address', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { mod, prefixes } = await loadWithFakeUpstash(limit);

    expect(await mod.consumeApplicationEmailQuota('Ana@Example.com')).toBe(true);
    expect(prefixes).toContain('tims:ratelimit:application-email');
    const key = limit.mock.calls[0]![0] as string;
    expect(key).toBe(createHash('sha256').update('ana@example.com').digest('hex'));
    expect(key).not.toContain('@');
  });

  it('denies when the cap is hit, and fails closed on an Upstash timeout', async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, reason: 'timeout' });
    const { mod } = await loadWithFakeUpstash(limit);

    expect(await mod.consumeApplicationEmailQuota('ana@example.com')).toBe(false);
    expect(await mod.consumeApplicationEmailQuota('ana@example.com')).toBe(false);
  });

  it('propagates an Upstash error so the caller skips the email', async () => {
    const { mod } = await loadWithFakeUpstash(() => Promise.reject(new Error('ECONNRESET')));
    await expect(mod.consumeApplicationEmailQuota('ana@example.com')).rejects.toThrow('ECONNRESET');
  });
});
