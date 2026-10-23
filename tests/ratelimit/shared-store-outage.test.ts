import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, type FakeMode, installFakeDynamo, stubSharedStoreEnv } from './fake-dynamodb';

// PR #358 review fix: a shared-store outage must not take the whole app down. Each shared
// limiter call is bounded to ~1s (the in-flight request is aborted); on timeout/error the
// auth, AI and export tiers (and credential-like paths) fail CLOSED, every other tier fails
// OPEN to the per-instance memory limiter with a structured, PII-free warning.

const RATE_LIMIT = '../../packages/api/src/middleware/rate-limit';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

async function loadWithFakeDynamo(mode: FakeMode) {
  vi.resetModules();
  stubSharedStoreEnv('production');
  const fake = installFakeDynamo(mode);
  const mod = await import(RATE_LIMIT);
  // Same module graph as rate-limit.ts after resetModules, so this is the logger it uses.
  const { logger } = await import('@tims/shared');
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return { mod, warn, fake };
}

describe('shared limiter is bounded', () => {
  it('configures the client to stay inside the ~1s deadline and passes an abort signal on every call', async () => {
    const { mod, fake } = await loadWithFakeDynamo('ok');
    expect(mod.SHARED_LIMIT_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
    expect(fake.clientConfigs).toHaveLength(1);
    const config = fake.clientConfigs[0]!;
    expect(config.region).toBe('us-west-2');
    expect(config.maxAttempts).toBeLessThanOrEqual(2);
    expect(config.requestHandler).toMatchObject({ requestTimeout: mod.SHARED_LIMIT_TIMEOUT_MS });
    await mod.checkRateLimit('user-1', 'query');
    await mod.consumeApplicationEmailQuota('ana@example.com');
    expect(fake.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of fake.calls) {
      expect(call.hasAbortSignal).toBe(true);
      expect(call.input.TableName).toBe('tims-ats-ratelimit');
    }
  });

  it('settles (and aborts) a hanging store call within the deadline', async () => {
    vi.useFakeTimers();
    const { mod, fake } = await loadWithFakeDynamo('hang');
    let settled = false;
    const p = mod.checkRateLimit('user-1', 'query').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(fake.aborted).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    // The deadline must release the socket, not just stop waiting for it.
    expect(fake.aborted).toBe(1);
  });
});

describe.each([
  ['hanging call (own deadline)', 'hang'],
  ['store error', 'error'],
] as const)('outage: %s', (_label, mode) => {
  it.each(['auth', 'ai', 'export'] as const)('fails CLOSED for the %s tier', async (category) => {
    vi.useFakeTimers();
    const { mod, warn } = await loadWithFakeDynamo(mode);
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
      const { mod, warn } = await loadWithFakeDynamo(mode);
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
    const { mod } = await loadWithFakeDynamo(mode);
    expect(mod.isFailClosedPath('platform.acceptInvitation')).toBe(true);
    const p = mod.checkRateLimit('ip:203.0.113.9', 'mutation', { path: 'platform.acceptInvitation' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await assertion;
  });
});

describe('fail-open still limits per instance', () => {
  it('enforces the in-memory query limit while the shared store is down', async () => {
    const { mod } = await loadWithFakeDynamo('error');
    for (let i = 0; i < 100; i++) await mod.checkRateLimit('user-flood', 'query');
    await expect(mod.checkRateLimit('user-flood', 'query')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

describe('outage log is observable but carries no PII and does not flood', () => {
  it('never logs the identifier or the raw error message, and throttles repeats', async () => {
    const { mod, warn } = await loadWithFakeDynamo('error');
    await mod.checkRateLimit('user-secret-id', 'query');
    await mod.checkRateLimit('user-secret-id', 'query');
    await mod.checkRateLimit('ip:198.51.100.7', 'query');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('user-secret-id');
    expect(logged).not.toContain('198.51.100.7');
    expect(logged).not.toContain('dynamodb.us-west-2');
    expect(logged).not.toContain('747814092517');
    expect(warn.mock.calls[0]![0]).toMatchObject({
      cause: 'error',
      errorName: 'ProvisionedThroughputExceededException',
    });
  });
});

describe('healthy shared store is unchanged', () => {
  it('allows up to the tier limit and returns TOO_MANY_REQUESTS on a real deny', async () => {
    const { mod, warn } = await loadWithFakeDynamo('ok');
    for (let i = 0; i < 10; i++) await expect(mod.checkRateLimit('user-1', 'auth')).resolves.toBeUndefined();
    await expect(mod.checkRateLimit('user-1', 'auth')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // Another identifier has its own budget.
    await expect(mod.checkRateLimit('user-2', 'auth')).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('isFailClosedPath', () => {
  it('covers invitation, password-reset and offer-signing token paths, case-insensitively', async () => {
    const { mod } = await loadWithFakeDynamo('hang');
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
