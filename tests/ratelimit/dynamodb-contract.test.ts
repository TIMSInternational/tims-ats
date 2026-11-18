import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DYNAMODB_SDK, installFakeDynamo } from './fake-dynamodb';

// The TS and C# limiters share ONE DynamoDB table and must read and write the same items, or a
// caller gets a separate budget on each stack. contracts/ratelimit-fixtures/dynamodb.json freezes
// the item layout and the exact expressions; the C# suite asserts the same file
// (Tims.IntegrationTests/RateLimiting/DynamoDbContractFixtureTests.cs and
// Tims.UnitTests/RateLimiting/DynamoDbKeyLayoutFixtureTests.cs).

const CONTRACT = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/ratelimit-fixtures/dynamodb.json'), 'utf8'),
) as {
  table: { partitionKey: string; ttlAttribute: string };
  slidingWindow: {
    updateExpression: string;
    conditionWithPrevious: string;
    conditionWithoutPrevious: string;
    attempts: number;
    contentionRetryMs: number;
  };
  claim: { conditionExpression: string; prefixes: { applicationEmail: string } };
  budgets: Record<string, { tokens: number; windowMs: number }>;
  partitionKeys: Array<{ category: string; identifier: string; pk: string }>;
};

const STORE = '../../packages/api/src/middleware/rate-limit-store';
const WINDOW = 60_000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock(DYNAMODB_SDK);
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  const fake = installFakeDynamo('ok');
  const { createSharedStore } = await import(STORE);
  return { fake, store: createSharedStore({ table: 'tims-ats-ratelimit', region: 'us-west-2' }) };
}

describe('DynamoDB rate-limit contract (shared with C#)', () => {
  it('derives the frozen partition key for every fixture identifier', async () => {
    expect(CONTRACT.partitionKeys.length).toBeGreaterThanOrEqual(5);
    const { fake, store } = await load();
    for (const { category, identifier, pk } of CONTRACT.partitionKeys) {
      await store.slidingWindow(`rl#${category}`, identifier, 10, WINDOW);
      expect(fake.calls.at(-1)!.input.Key!.pk.S, `${category} ${identifier}`).toBe(pk);
    }
  });

  it('sends the frozen update and condition expressions, with and without a previous window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 1_000);
    const { fake, store } = await load();
    await store.slidingWindow('rl#query', 'user-1', 10, WINDOW);
    vi.setSystemTime(T0 + WINDOW + 1_000);
    await store.slidingWindow('rl#query', 'user-1', 10, WINDOW);
    const [first, second] = fake.calls.filter((c) => c.op === 'UpdateItem');
    expect(first!.input.UpdateExpression).toBe(CONTRACT.slidingWindow.updateExpression);
    expect(first!.input.ConditionExpression).toBe(CONTRACT.slidingWindow.conditionWithoutPrevious);
    expect(second!.input.ConditionExpression).toBe(CONTRACT.slidingWindow.conditionWithPrevious);
    const bucket = T0 / WINDOW;
    expect(first!.input.ExpressionAttributeNames).toMatchObject({
      '#cur': `w${bucket}`,
      '#prev': `w${bucket - 1}`,
      '#next': `w${bucket + 1}`,
      '#e': CONTRACT.table.ttlAttribute,
    });
    expect(first!.input.ExpressionAttributeValues![':exp']!.N).toBe(
      String(Math.ceil(((bucket + 2) * WINDOW) / 1000) + 60),
    );
  });

  it('uses the frozen budget for every category', async () => {
    const { LIMITS, TS_ONLY_CATEGORIES } = await import('../../packages/api/src/middleware/rate-limit');
    const windowMs: Record<string, number> = { '1m': 60_000, '5m': 300_000 };
    const budgets = Object.fromEntries(
      Object.entries(CONTRACT.budgets).filter(([key]) => !key.startsWith('$')),
    );
    // TS-only tiers (CV-upload presign) are not part of the cross-stack contract; every other tier is.
    const shared = Object.entries(LIMITS).filter(([category]) => !TS_ONLY_CATEGORIES.has(category as keyof typeof LIMITS));
    expect(shared.map(([category]) => category).sort()).toEqual(Object.keys(budgets).sort());
    for (const [category, { requests, window }] of shared) {
      expect({ tokens: requests, windowMs: windowMs[window] }, category).toEqual(budgets[category]);
    }
  });

  it('declares only the CV-upload tiers as TS-only, and none of them is in the contract', async () => {
    const { TS_ONLY_CATEGORIES } = await import('../../packages/api/src/middleware/rate-limit');
    expect([...TS_ONLY_CATEGORIES].sort()).toEqual(['cvUpload', 'cvUploadVacancy']);
    for (const category of TS_ONLY_CATEGORIES) expect(CONTRACT.budgets, category).not.toHaveProperty(category);
  });

  it('reads with ConsistentRead and claims with the frozen claim condition and prefix', async () => {
    const { fake, store } = await load();
    await store.slidingWindow('rl#auth', 'ip:198.51.100.23', 10, WINDOW);
    expect(fake.calls.find((c) => c.op === 'GetItem')!.input.ConsistentRead).toBe(true);
    await store.claimOnce(CONTRACT.claim.prefixes.applicationEmail.replace(/#$/, ''), 'abc', 1000);
    const put = fake.calls.find((c) => c.op === 'PutItem')!;
    expect(put.input.ConditionExpression).toBe(CONTRACT.claim.conditionExpression);
    expect(put.input.Item!.pk.S).toBe(`${CONTRACT.claim.prefixes.applicationEmail}abc`);
  });
});
