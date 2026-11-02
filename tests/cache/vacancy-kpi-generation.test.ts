import { beforeEach, describe, expect, it, vi } from 'vitest';

// Codex P2 on #398: a KPI request that read pre-hire counts must not be able to re-cache them after the
// hire's invalidation. The cache key carries a per-tenant generation that the hire bumps after commit, so the
// slow request writes under the OLD key, which no later reader uses. A shared store is modelled by one Map.

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  cacheSet: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
  cacheInvalidatePrefix: vi.fn(async (prefix: string) => {
    for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
  }),
}));

import { bumpVacancyKpiGeneration, vacancyKpiCacheKey } from '../../packages/api/src/lib/vacancy-kpi-cache';

beforeEach(() => store.clear());

describe('vacancy KPI cache generation', () => {
  it('a request that started before a hire cannot re-cache its pre-hire counts for later readers', async () => {
    // Request A: reads the generation (key) BEFORE computing, then is slow.
    const keyA = await vacancyKpiCacheKey('org-a', 'organization');
    // The hire commits and bumps the generation.
    await bumpVacancyKpiGeneration('org-a');
    // A finishes and caches its stale result under its (old-generation) key.
    store.set(keyA, { totalOpen: 1 });
    // A later reader uses the NEW generation's key: it misses and recomputes fresh counts.
    const keyB = await vacancyKpiCacheKey('org-a', 'organization');
    expect(keyB).not.toBe(keyA);
    expect(store.has(keyB)).toBe(false);
  });

  it('keys are stable within a generation and isolated per tenant and scope', async () => {
    const k1 = await vacancyKpiCacheKey('org-a', 'organization');
    expect(await vacancyKpiCacheKey('org-a', 'organization')).toBe(k1);
    expect(await vacancyKpiCacheKey('org-b', 'organization')).not.toBe(k1);
    expect(await vacancyKpiCacheKey('org-a', 'team:u1')).not.toBe(k1);
    await bumpVacancyKpiGeneration('org-b');
    expect(await vacancyKpiCacheKey('org-a', 'organization')).toBe(k1);
  });
});
