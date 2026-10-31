import { createHash } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo, stubSharedStoreEnv } from './fake-dynamodb';

// #308 security fix: the unauthenticated apply form chooses the recipient of the
// "application received" email, so the platform caps it at ONE per address per 24h.
// Covers both the in-memory fallback (no shared store: local dev + tests) and the DynamoDB
// path (an in-memory fake of the SDK), including the fail-closed timeout / error behaviour.

const RATE_LIMIT = '../../packages/api/src/middleware/rate-limit';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

async function loadInMemory() {
  vi.resetModules();
  stubSharedStoreEnv('development', '', '');
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

describe('consumeApplicationEmailQuota — shared store path', () => {
  async function loadWithFakeDynamo(mode: 'ok' | 'hang' | 'error') {
    vi.resetModules();
    stubSharedStoreEnv('production');
    const fake = installFakeDynamo(mode);
    const mod = await import(RATE_LIMIT);
    return { mod, fake };
  }

  it('keys the claim on sha256(lowercased address), never the raw address', async () => {
    const { mod, fake } = await loadWithFakeDynamo('ok');

    expect(await mod.consumeApplicationEmailQuota('Ana@Example.com')).toBe(true);
    const put = fake.calls.find((c) => c.op === 'PutItem')!;
    const pk = put.input.Item!.pk.S!;
    expect(pk).toBe(`ae#${createHash('sha256').update('ana@example.com').digest('hex')}`);
    expect(pk).not.toContain('@');
  });

  it('allows one send per address per rolling 24h, independent per address', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const { mod } = await loadWithFakeDynamo('ok');

    expect(await mod.consumeApplicationEmailQuota('ana@example.com')).toBe(true);
    expect(await mod.consumeApplicationEmailQuota(' ANA@Example.com ')).toBe(false);
    expect(await mod.consumeApplicationEmailQuota('luis@example.com')).toBe(true);

    vi.setSystemTime(new Date('2026-10-01T11:59:59Z'));
    expect(await mod.consumeApplicationEmailQuota('ana@example.com')).toBe(false);
    // An expired claim TTL has not deleted yet must not block the next send.
    vi.setSystemTime(new Date('2026-10-01T12:00:01Z'));
    expect(await mod.consumeApplicationEmailQuota('ana@example.com')).toBe(true);
  });

  it('fails closed (rejects, so the caller skips the email) on a store error', async () => {
    const { mod } = await loadWithFakeDynamo('error');
    await expect(mod.consumeApplicationEmailQuota('ana@example.com')).rejects.toThrow();
  });

  it('fails closed on a hanging store within the deadline', async () => {
    vi.useFakeTimers();
    const { mod } = await loadWithFakeDynamo('hang');
    const p = mod.consumeApplicationEmailQuota('ana@example.com');
    const assertion = expect(p).rejects.toMatchObject({ name: 'SharedLimiterTimeoutError' });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await assertion;
  });
});
