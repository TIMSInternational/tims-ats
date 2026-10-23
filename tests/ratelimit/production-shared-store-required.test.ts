import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo, stubSharedStoreEnv } from './fake-dynamodb';

const RATE_LIMIT = '../../packages/api/src/middleware/rate-limit';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

describe('rate-limit store configuration', () => {
  it('refuses per-instance memory counters in Vercel production', async () => {
    vi.resetModules();
    stubSharedStoreEnv('production', '', '');
    await expect(import(RATE_LIMIT)).rejects.toThrow(
      'Production rate limiting requires the shared DynamoDB table (RATE_LIMIT_DYNAMODB_TABLE)',
    );
  });

  it.each([
    ['table without region', 'tims-ats-ratelimit', ''],
    ['region without table', '', 'us-west-2'],
  ])('rejects a half-configured store in any environment (%s)', async (_label, table, region) => {
    vi.resetModules();
    stubSharedStoreEnv('preview', table, region);
    await expect(import(RATE_LIMIT)).rejects.toThrow(
      'Rate limiting requires both RATE_LIMIT_DYNAMODB_TABLE and RATE_LIMIT_DYNAMODB_REGION',
    );
  });

  it.each([
    ['a table name with a space', 'tims ats', 'us-west-2', 'RATE_LIMIT_DYNAMODB_TABLE is not a valid'],
    ['an ARN instead of a name', 'arn:aws:dynamodb:us-west-2:1:table/x', 'us-west-2', 'RATE_LIMIT_DYNAMODB_TABLE is not a valid'],
    ['a region typo', 'tims-ats-ratelimit', 'us-west2', 'RATE_LIMIT_DYNAMODB_REGION is not a valid'],
  ])('rejects %s at boot instead of failing every request', async (_label, table, region, message) => {
    vi.resetModules();
    stubSharedStoreEnv('production', table, region);
    await expect(import(RATE_LIMIT)).rejects.toThrow(message);
  });

  it('does not break previews: a Vercel preview with no shared store loads and uses memory', async () => {
    vi.resetModules();
    stubSharedStoreEnv('preview', '', '');
    const { checkRateLimit } = await import(RATE_LIMIT);
    await expect(checkRateLimit('synthetic-id', 'auth')).resolves.toBeUndefined();
  });

  it('allows local fallback and a fully configured production store', async () => {
    vi.resetModules();
    stubSharedStoreEnv('development', '', '');
    await expect(import(RATE_LIMIT)).resolves.toHaveProperty('checkRateLimit');

    vi.resetModules();
    stubSharedStoreEnv('production');
    installFakeDynamo('ok');
    await expect(import(RATE_LIMIT)).resolves.toHaveProperty('checkRateLimit');
  });

  it('fails closed when the shared limiter is unreachable instead of allowing the request', async () => {
    vi.resetModules();
    stubSharedStoreEnv('production');
    installFakeDynamo('error');
    const { checkRateLimit } = await import(RATE_LIMIT);
    await expect(checkRateLimit('synthetic-id', 'auth')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
