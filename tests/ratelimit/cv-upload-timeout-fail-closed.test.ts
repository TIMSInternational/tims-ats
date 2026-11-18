import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, type FakeMode, installFakeDynamo, stubSharedStoreEnv } from './fake-dynamodb';

// #380 on the #358 DynamoDB store: each CV-upload presign URL is an S3 write, so when the shared
// store is unavailable (its own ~1s deadline, or an error) the cvUpload and cvUploadVacancy tiers
// fail CLOSED like auth/ai/export, instead of degrading to the per-instance memory limiter.

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
  installFakeDynamo(mode);
  return import(RATE_LIMIT);
}

describe.each([
  ['hanging call (own deadline)', 'hang'],
  ['store error', 'error'],
] as const)('CV-upload tiers on a shared-store outage: %s', (_label, mode) => {
  it.each(['cvUpload', 'cvUploadVacancy'] as const)('%s fails CLOSED', async (category) => {
    vi.useFakeTimers();
    const mod = await loadWithFakeDynamo(mode);
    const p = mod.checkRateLimit('ip:203.0.113.9', category);
    const assertion = expect(p).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await assertion;
  });

  it('the mutation tier still fails OPEN (unchanged by these tiers)', async () => {
    vi.useFakeTimers();
    const mod = await loadWithFakeDynamo(mode);
    const p = mod.checkRateLimit('user-1', 'mutation');
    await vi.advanceTimersByTimeAsync(mod.SHARED_LIMIT_TIMEOUT_MS);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('CV-upload tiers with a healthy store', () => {
  it('a request inside the budget passes', async () => {
    const mod = await loadWithFakeDynamo('ok');
    await expect(mod.checkRateLimit('ip:203.0.113.9', 'cvUpload')).resolves.toBeUndefined();
  });

  it('portal.getCvUploadUrl maps to the cvUpload tier', async () => {
    const mod = await loadWithFakeDynamo('ok');
    expect(mod.getRateLimitCategory('portal.getCvUploadUrl', 'mutation')).toBe('cvUpload');
    expect(mod.getRateLimitCategory('portal.getCvUploadUrl', 'query')).toBe('cvUpload');
  });
});
