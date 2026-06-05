import { createHash } from 'crypto';
import { Redis } from '@upstash/redis';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// AI response cache — keyed by hash(agentSlug + orgId + inputs).
//
// Purpose: identical AI requests (e.g. the same job title written twice) should
// not pay Bedrock twice. The TTL is owned by each agent (AiAgent.cacheTtlSeconds)
// so PII-bearing agents opt out with ttl=0 (cv-parser, candidate-screener) and
// idempotent text agents opt in (vacancy-writer 30d, inclusive-language 1d).
//
// Tenant safety: the org id is part of the cache key, so one org can NEVER read
// another org's cached AI output. A ttl of 0 short-circuits both read and write
// (no Redis round-trip, nothing ever stored).
//
// Production uses Upstash Redis (same creds as the rate limiter); local dev with
// no Upstash env falls back to an in-memory Map with TTL expiry.
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'tims:ai:cache';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;

// In-memory fallback (local dev / missing env vars).
interface MemoryEntry {
  value: string;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

/**
 * Stable JSON stringify — object keys are sorted recursively so that inputs
 * that differ only in key order produce the SAME cache key.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** Build the org-scoped cache key for an agent invocation. */
export function cacheKey(slug: string, orgId: string, input: unknown): string {
  const hash = createHash('sha256').update(`${orgId}:${canonicalize(input)}`).digest('hex');
  return `${KEY_PREFIX}:${slug}:${hash}`;
}

/**
 * Read a cached AI result. Returns null on miss, ttl<=0 (caching disabled), or
 * any backend error (fail-soft — a cache outage must never block an AI call).
 */
export async function getCached<T>(
  slug: string,
  orgId: string,
  input: unknown,
  ttlSeconds: number,
): Promise<T | null> {
  if (ttlSeconds <= 0) return null;
  const key = cacheKey(slug, orgId, input);

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
    logger.warn({ err, slug }, 'AI cache read failed — treating as miss');
    return null;
  }
}

/**
 * Store an AI result. No-op when ttl<=0 (caching disabled) or on backend error
 * (fail-soft — failing to cache must never fail the request).
 */
export async function setCached<T>(
  slug: string,
  orgId: string,
  input: unknown,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  if (ttlSeconds <= 0) return;
  const key = cacheKey(slug, orgId, input);
  const serialized = JSON.stringify(value);

  try {
    if (redis) {
      await redis.set(key, serialized, { ex: ttlSeconds });
      return;
    }
    memoryStore.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });
  } catch (err) {
    logger.warn({ err, slug }, 'AI cache write failed — continuing without cache');
  }
}
