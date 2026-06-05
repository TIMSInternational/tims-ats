import { describe, it, expect } from 'vitest';
import { cacheKey, getCached, setCached } from '../../packages/ai/src/cache';

// No UPSTASH_* env in CI/dev → the cache uses its in-memory fallback, so these
// exercise the real read/write/expiry/tenant-isolation logic deterministically.

describe('AI response cache', () => {
  const slug = 'vacancy-writer';
  const ttl = 60;

  it('round-trips a value under a positive TTL', async () => {
    const input = { title: 'Backend Engineer' };
    await setCached(slug, 'org-a', input, { description: 'hello' }, ttl);
    const hit = await getCached<{ description: string }>(slug, 'org-a', input, ttl);
    expect(hit).toEqual({ description: 'hello' });
  });

  it('isolates cache by organization (no cross-tenant reads)', async () => {
    const input = { title: 'Shared Title' };
    await setCached(slug, 'org-1', input, { description: 'org-1 secret' }, ttl);
    const otherOrg = await getCached(slug, 'org-2', input, ttl);
    expect(otherOrg).toBeNull();
  });

  it('treats ttl<=0 as caching disabled (never reads or writes)', async () => {
    const input = { title: 'No Cache' };
    await setCached(slug, 'org-a', input, { description: 'should not persist' }, 0);
    expect(await getCached(slug, 'org-a', input, 0)).toBeNull();
    // even with a positive read ttl, nothing was written under ttl=0
    expect(await getCached(slug, 'org-a', input, ttl)).toBeNull();
  });

  it('produces a stable key regardless of input property order', () => {
    const a = cacheKey(slug, 'org-a', { title: 'X', context: 'Y' });
    const b = cacheKey(slug, 'org-a', { context: 'Y', title: 'X' });
    expect(a).toBe(b);
  });

  it('produces different keys for different agents, orgs, and inputs', () => {
    const base = cacheKey('vacancy-writer', 'org-a', { title: 'X' });
    expect(cacheKey('inclusive-language', 'org-a', { title: 'X' })).not.toBe(base);
    expect(cacheKey('vacancy-writer', 'org-b', { title: 'X' })).not.toBe(base);
    expect(cacheKey('vacancy-writer', 'org-a', { title: 'Z' })).not.toBe(base);
  });

  it('returns a miss for a never-written key', async () => {
    expect(await getCached(slug, 'org-never', { title: 'absent' }, ttl)).toBeNull();
  });
});
