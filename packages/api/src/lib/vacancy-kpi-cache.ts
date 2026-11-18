import { cacheGet, cacheInvalidatePrefix, cacheSet } from './cache';

// Vacancy KPI cache keys carry a per-tenant GENERATION. A hire (which can close a vacancy and move an
// application out of the active pipeline) bumps it after its transaction commits. A KPI request that read
// the old generation before the bump writes under the old key, which no later reader looks up, so a slow
// in-flight request can never re-cache pre-hire counts after the invalidation.
//
// Both prefixes are shared-only in lib/cache.ts: with the per-instance memory backend nothing here is cached
// (KPIs are read fresh); with the shared Upstash store every instance sees the same generation.

const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const generationKey = (orgId: string) => `tims:kpis:vacancy-gen:${orgId}`;

/** The cache key for one tenant + scope at the tenant's current generation. Read the generation FIRST. */
export async function vacancyKpiCacheKey(orgId: string, scopeDiscriminator: string): Promise<string> {
  const generation = (await cacheGet<string>(generationKey(orgId))) ?? '0';
  return `tims:kpis:vacancy:${orgId}:${generation}:${scopeDiscriminator}`;
}

/** Call AFTER a write that changes vacancy KPIs has committed. */
export async function bumpVacancyKpiGeneration(orgId: string): Promise<void> {
  await cacheSet(
    generationKey(orgId),
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    GENERATION_TTL_SECONDS,
  );
  // Drop the entries of the previous generations too (they are unreachable, this just frees them).
  await cacheInvalidatePrefix(`tims:kpis:vacancy:${orgId}:`);
}
