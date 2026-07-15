import { TRPCError } from '@trpc/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Upstash Redis (production) — falls back to in-memory for local dev
// ---------------------------------------------------------------------------
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;

// ---------------------------------------------------------------------------
// Rate-limit definitions per category
// ---------------------------------------------------------------------------
const LIMITS = {
  mutation: { requests: 30, window: '1m' as const },   // 30 mutations/min
  query: { requests: 100, window: '1m' as const },     // 100 queries/min
  auth: { requests: 10, window: '5m' as const },       // 10 auth attempts/5min
  ai: { requests: 10, window: '1m' as const },         // 10 AI calls/min
  export: { requests: 5, window: '5m' as const },      // 5 exports/5min
} as const;

type RateLimitCategory = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// Upstash limiters (one per category, created lazily)
// ---------------------------------------------------------------------------
function createUpstashLimiter(category: RateLimitCategory): Ratelimit | null {
  if (!redis) return null;
  const { requests, window } = LIMITS[category];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `tims:ratelimit:${category}`,
  });
}

const upstashLimiters: Record<RateLimitCategory, Ratelimit | null> = {
  mutation: createUpstashLimiter('mutation'),
  query: createUpstashLimiter('query'),
  auth: createUpstashLimiter('auth'),
  ai: createUpstashLimiter('ai'),
  export: createUpstashLimiter('export'),
};

// ---------------------------------------------------------------------------
// In-memory fallback (local dev / missing env vars)
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt < now) memoryStore.delete(key);
  }
}, 5 * 60 * 1000);

/** Converts our window notation to milliseconds */
function windowToMs(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60_000;
  const [, value, unit] = match;
  const n = parseInt(value!, 10);
  switch (unit) {
    case 's': return n * 1_000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: return 60_000;
  }
}

function checkMemoryRateLimit(identifier: string, category: RateLimitCategory): void {
  const { requests, window } = LIMITS[category];
  const windowMs = windowToMs(window);
  const now = Date.now();
  const key = `${category}:${identifier}`;

  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  entry.count++;

  if (entry.count > requests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfter} segundos.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API — same interface as before, no changes needed in trpc.ts
// ---------------------------------------------------------------------------

export async function checkRateLimit(
  identifier: string,
  category: RateLimitCategory = 'query'
): Promise<void> {
  const upstash = upstashLimiters[category];

  if (upstash) {
    const { success, reset } = await upstash.limit(identifier);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfter} segundos.`,
      });
    }
    return;
  }

  // Fallback: in-memory (local dev)
  checkMemoryRateLimit(identifier, category);
}

// AI-backed endpoints (cost-controlled, capped per-org). Keep in sync with the
// live agents in packages/ai and the stubbed-AI procedures so none escape the AI
// tier. Matched case-insensitively. NOTE: precise per-procedure tagging should
// replace this heuristic once all AI calls route through the central invokeAgent
// pipeline (Phase 1). `simulate` is intentionally excluded — compensation's
// simulate-adjustment is a pure calculation, not an AI call.
const AI_PATH_KEYWORDS = [
  'generate', 'parse', 'analyze', 'inclusive', 'screen', 'recommend',
  'explainab', 'nextbestaction', 'detectbias', 'wordcloud', 'sentiment',
  'medical', 'getguide', 'faq', 'assistant',
];

export function getRateLimitCategory(path: string, type: 'query' | 'mutation'): RateLimitCategory {
  // Auth endpoints
  if (path.startsWith('auth.')) return 'auth';
  const p = path.toLowerCase();
  // AI-related endpoints
  if (AI_PATH_KEYWORDS.some((k) => p.includes(k))) return 'ai';
  // Export endpoints
  if (p.includes('export')) return 'export';
  // Default by type
  return type;
}
