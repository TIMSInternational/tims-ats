import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo } from './fake-dynamodb';

// The DynamoDB store must reproduce @upstash/ratelimit's slidingWindow, which the limiter
// used before: the previous window's count is weighted by how much of it still overlaps the
// sliding window, a DENIED request is not counted, and admission is atomic (Upstash ran one
// Lua script; here both windows live on one item and one conditional write checks both).

const STORE = '../../packages/api/src/middleware/rate-limit-store';
const WINDOW = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0); // a window boundary for 60s windows
const W0 = T0 / WINDOW;
const ID = 'user-1';
const PK = `rl#query#${createHash('sha256').update(ID).digest('hex')}`;

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

type Store = Awaited<ReturnType<typeof load>>['store'];
const once = (store: Store, id = ID) => store.slidingWindow('rl#query', id, 10, WINDOW);

/** Waits until `count` UpdateItem calls have been issued (i.e. are queued while held). */
async function untilUpdates(fake: Awaited<ReturnType<typeof load>>['fake'], count: number): Promise<void> {
  for (let i = 0; i < 1_000 && fake.calls.filter((c) => c.op === 'UpdateItem').length < count; i++) {
    await Promise.resolve();
  }
  expect(fake.calls.filter((c) => c.op === 'UpdateItem').length).toBe(count);
}

async function hits(store: Store, n: number): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < n; i++) if ((await once(store)).success) allowed++;
  return allowed;
}

describe('shared store sliding window', () => {
  it('allows exactly the limit in one window and does not count denied requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, fake } = await load();
    expect(await hits(store, 15)).toBe(10);
    expect(fake.items.get(PK)![`w${W0}`]).toBe(10);
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

  it('reads strongly consistently (a stale read would double the quota)', async () => {
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

  it('a request computed before a boundary that commits after it cannot exceed the quota (Codex repro)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + WINDOW - 1);
    const { store, fake } = await load();
    // 10 requests read the empty previous window just before the boundary; their writes stall.
    fake.holdUpdates = true;
    const stalled = Array.from({ length: 10 }, () => once(store));
    await untilUpdates(fake, 10);
    // The boundary passes and 10 fresh requests run to completion.
    vi.setSystemTime(T0 + WINDOW + 1);
    fake.holdUpdates = false;
    expect(await hits(store, 10)).toBe(10);
    // The stalled writes now land: each must be rejected (a later window exists), re-read at
    // the current time, and be denied: the window is full.
    await fake.releaseHeld();
    const results = await Promise.all(stalled);
    expect(results.filter((r) => r.success)).toHaveLength(0);
    expect(fake.items.get(PK)![`w${W0}`]).toBeUndefined();
    expect(fake.items.get(PK)![`w${W0 + 1}`]).toBe(10);
  });

  it('a late previous-window write landing between our read and our write is seen (re-read)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + WINDOW - 1000);
    const { store, fake } = await load();
    expect(await hits(store, 9)).toBe(9);
    // A 10th previous-window request reads (9) and stalls; then the boundary arrives and a
    // new-window request reads the previous window as 9 and stalls too.
    fake.holdUpdates = true;
    const straggler = once(store);
    await untilUpdates(fake, 10);
    // Exactly at the boundary the previous window overlaps 100%: 9 seen -> room for 1, 10 -> none.
    vi.setSystemTime(T0 + WINDOW);
    const fresh = once(store);
    await untilUpdates(fake, 11);
    // The straggler lands first (previous window -> 10), then the fresh write: it must notice
    // the previous window changed, re-read, and be denied. Admitting it would make 11 of 10.
    fake.holdUpdates = false;
    await fake.releaseHeld();
    expect((await straggler).success).toBe(true);
    expect((await fresh).success).toBe(false);
    expect(fake.items.get(PK)![`w${W0}`]).toBe(10);
    expect(fake.items.get(PK)![`w${W0 + 1}`]).toBeUndefined();
  });

  it('concurrent requests in one window never block each other below the limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5_000);
    const { store, fake } = await load();
    const results = await Promise.all(Array.from({ length: 8 }, () => once(store)));
    expect(results.every((r) => r.success)).toBe(true);
    expect(fake.items.get(PK)![`w${W0}`]).toBe(8);
    // One read + one write each: no re-read loop when the windows do not move.
    expect(fake.calls.filter((c) => c.op === 'UpdateItem')).toHaveLength(8);
  });

  it('a concurrent burst cannot exceed the limit (every request reads before any writes)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 5_000);
    const { store, fake } = await load();
    const results = await Promise.all(Array.from({ length: 15 }, () => once(store)));
    expect(results.filter((r) => r.success)).toHaveLength(10);
    expect(fake.items.get(PK)![`w${W0}`]).toBe(10);
  });

  it("adopts a later window another instance's clock already opened, counting the previous one in full", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + WINDOW - 50); // this instance's clock is 50 ms behind
    const { store, fake } = await load();
    fake.items.set(PK, { [`w${W0}`]: 6, [`w${W0 + 1}`]: 1 });
    // Adopted window W0+1: previous 6 counted in full, 1 already used -> 3 more.
    expect(await hits(store, 10)).toBe(3);
    expect(fake.items.get(PK)![`w${W0 + 1}`]).toBe(4);
    expect(fake.items.get(PK)![`w${W0}`]).toBe(6);
  });

  it('removes counters older than the previous window from the item', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 3 * WINDOW + 1);
    const { store, fake } = await load();
    fake.items.set(PK, { [`w${W0}`]: 4, [`w${W0 + 2}`]: 2 });
    await once(store);
    expect(Object.keys(fake.items.get(PK)!).sort()).toEqual(['expiresAt', `w${W0 + 2}`, `w${W0 + 3}`].sort());
  });

  it('reports reset as the end of the current window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 15_000);
    const { store } = await load();
    expect(await once(store)).toEqual({ success: true, reset: T0 + WINDOW });
  });

  it('stores sha256(identifier) — never the raw user id or IP — and a TTL past the next window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store, fake } = await load();
    await store.slidingWindow('rl#auth', 'ip:203.0.113.9', 10, WINDOW);
    const update = fake.calls.find((c) => c.op === 'UpdateItem')!;
    const digest = createHash('sha256').update('ip:203.0.113.9').digest('hex');
    expect(update.input.Key!.pk.S).toBe(`rl#auth#${digest}`);
    expect(JSON.stringify(fake.calls)).not.toContain('203.0.113.9');
    expect(fake.items.get(`rl#auth#${digest}`)!.expiresAt).toBe((T0 + 2 * WINDOW) / 1000 + 60);
  });

  it('keeps tiers and identifiers apart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { store } = await load();
    expect(await hits(store, 10)).toBe(10);
    expect((await once(store, 'user-2')).success).toBe(true);
    expect((await store.slidingWindow('rl#mutation', ID, 10, WINDOW)).success).toBe(true);
  });
});

describe('readSharedStoreConfig', () => {
  it('returns undefined only when both variables are absent or empty', async () => {
    const { readSharedStoreConfig } = await import(STORE);
    expect(readSharedStoreConfig({})).toBeUndefined();
    expect(readSharedStoreConfig({ RATE_LIMIT_DYNAMODB_TABLE: '', RATE_LIMIT_DYNAMODB_REGION: '' })).toBeUndefined();
    expect(
      readSharedStoreConfig({
        RATE_LIMIT_DYNAMODB_TABLE: 'tims-ats-ratelimit',
        RATE_LIMIT_DYNAMODB_REGION: 'us-west-2',
      }),
    ).toEqual({ table: 'tims-ats-ratelimit', region: 'us-west-2' });
  });
});
