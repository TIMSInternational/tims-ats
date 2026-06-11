import { Redis } from '@upstash/redis';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// Cache-aside layer (Upstash Redis, in-memory fallback for local dev).
//
// General-purpose key/value cache for hot, rarely-changing reads — the first
// consumer is the per-request permission check (see trpc.ts), which otherwise
// hits the DB on EVERY authed request. CLAUDE.md §8: permission checks 5 min,
// org settings 10 min, dashboard KPIs 30-60s.
//
// Fail-soft by design: any Redis error is logged and treated as a miss / no-op,
// so a cache outage degrades to direct DB reads rather than failing requests.
// ---------------------------------------------------------------------------

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;

interface MemoryEntry {
  value: string;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redis) {
      const raw = await redis.get<string>(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed — treating as miss');
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  const serialized = JSON.stringify(value);
  try {
    if (redis) {
      await redis.set(key, serialized, { ex: ttlSeconds });
      return;
    }
    memoryStore.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed — continuing without cache');
  }
}

/** Delete every key under a prefix. Used to invalidate a tenant's cached entries. */
export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  try {
    if (redis) {
      // Upstash supports KEYS; the cardinality here (one tenant's perm keys) is small.
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(...keys);
      return;
    }
    for (const key of memoryStore.keys()) {
      if (key.startsWith(prefix)) memoryStore.delete(key);
    }
  } catch (err) {
    logger.warn({ err, prefix }, 'cache invalidation failed');
  }
}

/**
 * Invalidate all cached permission decisions for an org. Call whenever role
 * assignments or role→permission grants change for that org. Clears the scoped
 * access-decision entries (`tims:access:`) written by buildAccessForUser
 * (packages/api/src/access/build.ts), plus the legacy boolean `tims:perm:`
 * entries written by the pre-wave permission cache.
 */
export async function invalidatePermissionCache(orgId: string): Promise<void> {
  await Promise.all([
    cacheInvalidatePrefix(`tims:perm:${orgId}:`), // TODO remove after deploy flushes pre-wave entries
    cacheInvalidatePrefix(`tims:access:${orgId}:`),
  ]);
}
