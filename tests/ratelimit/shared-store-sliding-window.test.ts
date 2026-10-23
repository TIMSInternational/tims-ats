import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo } from './fake-dynamodb';

// The DynamoDB store must reproduce @upstash/ratelimit's slidingWindow, which the limiter
// used before: the previous window's count is weighted by how much of it still overlaps the
// sliding window, and a DENIED request is not counted (a user who hits the limit is not
// locked out for longer by retrying).

const STORE = '../../packages/api/src/middleware/rate-limit-store';
const WINDOW = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0); // a window boundary for 60s windows

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  const fake = installFakeDynamo('ok');
  const { createSharedStore } = await import(STORE);
  const store = createSharedStore({ table: 'tims-ats-ratelimit', region: 'us-west-2' });
  return { store, fake };
}

async function hits(store: Awaited<ReturnType<typeof load>>['store'], n: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < n; i++) if ((await store.slidingWindow('rl#query', 'user-1', 10, WINDOW)).success) allowed++;
  return allowed;
}

describe('shared store sliding window', () => {
  it('allows exactly the limit in one window and does not count denied requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, fake } = await load();
    expect(await hits(store, 15)).toBe(10);
    const counts = [...fake.items.values()].map((i) => i.c);
    expect(counts).toEqual([10]);
  });

  it('weights the previous window by its remaining overlap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store } = await load();
    expect(await hits(store, 10)).toBe(10);
    // 25% into the next window, 75% of the previous 10 still counts: floor(7.5) = 7, so 3 more.
    vi.setSystemTime(T0 + WINDOW + WINDOW / 4);
    expect(await hits(store, 10)).toBe(3);
    // Two full windows later nothing overlaps.
    vi.setSystemTime(T0 + 3 * WINDOW);
    expect(await hits(store, 12)).toBe(10);
  });

  it('reads the previous window strongly consistently (a stale read would double the quota)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, fake } = await load();
    fake.staleEventualReads = true;
    expect(await hits(store, 10)).toBe(10);
    // 1 ms into the next window almost all of the previous 10 still overlap: only 1 more fits.
    vi.setSystemTime(T0 + WINDOW + 1);
    expect(await hits(store, 10)).toBe(1);
    for (const call of fake.calls.filter((c) => c.op === 'GetItem')) expect(call.input.ConsistentRead).toBe(true);
  });

  it('reports reset as the end of the current window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 15_000);
    const { store } = await load();
    const result = await store.slidingWindow('rl#query', 'user-1', 10, WINDOW);
    expect(result).toEqual({ success: true, reset: T0 + WINDOW });
  });

  it('stores sha256(identifier) — never the raw user id or IP — and a TTL past the next window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, fake } = await load();
    await store.slidingWindow('rl#auth', 'ip:203.0.113.9', 10, WINDOW);
    const update = fake.calls.find((c) => c.op === 'UpdateItem')!;
    const pk = update.input.Key!.pk.S!;
    const digest = createHash('sha256').update('ip:203.0.113.9').digest('hex');
    expect(pk).toBe(`rl#auth#${digest}#${T0 / WINDOW}`);
    expect(JSON.stringify(fake.calls)).not.toContain('203.0.113.9');
    const expiresAt = [...fake.items.values()][0]!.expiresAt!;
    expect(expiresAt).toBe((T0 + 2 * WINDOW) / 1000 + 60);
  });

  it('keeps tiers and identifiers apart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store } = await load();
    expect(await hits(store, 10)).toBe(10);
    expect((await store.slidingWindow('rl#query', 'user-2', 10, WINDOW)).success).toBe(true);
    expect((await store.slidingWindow('rl#mutation', 'user-1', 10, WINDOW)).success).toBe(true);
  });
});

describe('readSharedStoreConfig', () => {
  it('returns undefined only when both variables are absent or empty', async () => {
    const { readSharedStoreConfig } = await import(STORE);
    expect(readSharedStoreConfig({})).toBeUndefined();
    expect(readSharedStoreConfig({ RATE_LIMIT_DYNAMODB_TABLE: '', RATE_LIMIT_DYNAMODB_REGION: '' })).toBeUndefined();
    expect(
      readSharedStoreConfig({ RATE_LIMIT_DYNAMODB_TABLE: 'tims-ats-ratelimit', RATE_LIMIT_DYNAMODB_REGION: 'us-west-2' }),
    ).toEqual({ table: 'tims-ats-ratelimit', region: 'us-west-2' });
  });
});
