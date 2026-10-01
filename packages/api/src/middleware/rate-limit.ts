import { createHash } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from '@tims/shared';

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
  mutation: { requests: 30, window: '1m' as const }, // 30 mutations/min
  query: { requests: 100, window: '1m' as const }, // 100 queries/min
  auth: { requests: 10, window: '5m' as const }, // 10 auth attempts/5min
  ai: { requests: 10, window: '1m' as const }, // 10 AI calls/min
  export: { requests: 5, window: '5m' as const }, // 5 exports/5min
} as const;

type RateLimitCategory = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// E2E-only ceiling (#330). The Playwright stack (scripts/e2e/up.sh) drives ONE user through several
// personas and two ordered journeys, so a persona's per-user window also holds every request an earlier
// persona of the same user made — and a Playwright retry re-runs the whole serial journey as the same
// users. The 100/min query tier was being exhausted by the test harness, not by any product behaviour
// (TOO_MANY_REQUESTS on pipeline.getBoard / candidate.getById in CI traces).
//
// The stack serves the production build, so NODE_ENV is 'production' there — NODE_ENV alone cannot tell
// it apart from production. The multiplier is therefore honoured only when ALL of these hold:
//   - TIMS_E2E_RATE_LIMIT_MULTIPLIER is an integer 1..1000;
//   - NODE_ENV is not 'production', OR the process explicitly marks itself TIMS_E2E_STACK=1;
//   - VERCEL / VERCEL_ENV are unset or empty. This is DEFENCE IN DEPTH only: it relies on the platform
//     setting those variables (Vercel does, at build and runtime), so it protects nothing on a host that
//     does not — the explicit marker above is the real gate;
// and it scales ONLY the in-memory limiter: the Upstash limiters are built from the raw LIMITS, so a
// deployment with Upstash configured (production) keeps the fixed limits whatever its env says. Both arms
// are pinned by tests/ratelimit/e2e-ceiling.test.ts.
// ---------------------------------------------------------------------------
export const E2E_RATE_LIMIT_MULTIPLIER_MAX = 1000;

export function resolveRateLimitMultiplier(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.TIMS_E2E_RATE_LIMIT_MULTIPLIER;
  if (raw === undefined || raw === '') return 1;
  if (env.NODE_ENV === 'production' && env.TIMS_E2E_STACK !== '1') return 1;
  if (env.VERCEL || env.VERCEL_ENV) return 1;
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return 1;
  return Math.min(Number(raw), E2E_RATE_LIMIT_MULTIPLIER_MAX);
}

const MEMORY_LIMIT_MULTIPLIER = resolveRateLimitMultiplier(process.env);
if (MEMORY_LIMIT_MULTIPLIER !== 1) {
  // Loud on purpose: if this ever appears outside the E2E stack's logs, something is misconfigured.
  logger.warn({ multiplier: MEMORY_LIMIT_MULTIPLIER }, 'rate-limit: E2E ceiling active (TIMS_E2E_STACK) — in-memory limits scaled');
}

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
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
      if (entry.resetAt < now) memoryStore.delete(key);
    }
  },
  5 * 60 * 1000,
);

/** Converts our window notation to milliseconds */
function windowToMs(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60_000;
  const [, value, unit] = match;
  const n = parseInt(value!, 10);
  switch (unit) {
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return 60_000;
  }
}

function checkMemoryRateLimit(identifier: string, category: RateLimitCategory): void {
  const { window } = LIMITS[category];
  const requests = LIMITS[category].requests * MEMORY_LIMIT_MULTIPLIER;
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

export async function checkRateLimit(identifier: string, category: RateLimitCategory = 'query'): Promise<void> {
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

// ---------------------------------------------------------------------------
// Per-RECIPIENT cap for the unauthenticated "application received" email (#308).
// The public apply form chooses the recipient address, so without a cap it could make
// the platform mail any inbox repeatedly via our SES identity. At most ONE such email per
// address per 24h, platform-wide. The key is sha256(lowercased address) — the raw
// address never reaches Redis or memory keys.
// Returns true only when a send is allowed. An Upstash timeout (the library then reports
// success with reason 'timeout') is treated as NOT allowed; an Upstash error propagates
// and the caller must treat it as NOT allowed too (fail closed — skip the email).
// ---------------------------------------------------------------------------
const APPLICATION_EMAIL_WINDOW_MS = 86_400_000;

const applicationEmailLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(1, '24 h'),
      prefix: 'tims:ratelimit:application-email',
    })
  : null;

const applicationEmailMemory = new Map<string, number>();

export async function consumeApplicationEmailQuota(recipientEmail: string): Promise<boolean> {
  const key = createHash('sha256').update(recipientEmail.trim().toLowerCase()).digest('hex');
  if (applicationEmailLimiter) {
    const { success, reason } = await applicationEmailLimiter.limit(key);
    return success && reason !== 'timeout';
  }
  // Fallback: in-memory (local dev / tests) — per-process, same 1-per-24h semantics.
  const now = Date.now();
  const until = applicationEmailMemory.get(key);
  if (until !== undefined && until > now) return false;
  if (applicationEmailMemory.size > 10_000) {
    for (const [k, v] of applicationEmailMemory) if (v <= now) applicationEmailMemory.delete(k);
  }
  applicationEmailMemory.set(key, now + APPLICATION_EMAIL_WINDOW_MS);
  return true;
}

// AI-backed endpoints (cost-controlled, capped per-org). Keep in sync with the
// live agents in packages/ai and the stubbed-AI procedures so none escape the AI
// tier. Matched case-insensitively. NOTE: precise per-procedure tagging should
// replace this heuristic once all AI calls route through the central invokeAgent
// pipeline (Phase 1). `simulate` is intentionally excluded — compensation's
// simulate-adjustment is a pure calculation, not an AI call.
const AI_PATH_KEYWORDS = [
  'generate',
  'parse',
  'analyze',
  'inclusive',
  'screen',
  'recommend',
  'explainab',
  'nextbestaction',
  'detectbias',
  'wordcloud',
  'sentiment',
  'medical',
  'getguide',
  'faq',
  'assistant',
];

export function getRateLimitCategory(path: string, type: 'query' | 'mutation'): RateLimitCategory {
  // Auth endpoints. Only auth MUTATIONS (credential-like attempts) take the strict `auth`
  // tier (10 / 5 min). Auth QUERIES are authenticated session reads — `auth.getSessionInfo`
  // and `auth.getImpersonationStatus` fire on EVERY staff page load, so putting them in the
  // credential tier throttled normal users with 429s after ~4-5 page views. They belong
  // to the ordinary `query` tier. Checked before the AI/export keywords so an auth read can
  // never be recategorized by a keyword substring.
  if (path.startsWith('auth.')) return type === 'mutation' ? 'auth' : 'query';
  const p = path.toLowerCase();
  // portal.applyToVacancy now synchronously invokes the AI cv-parser agent when a CV is
  // attached — the ai tier despite being an unauthenticated public mutation. Matched by
  // exact path, not an AI_PATH_KEYWORDS substring: the staff-authenticated
  // candidate.applyToVacancy shares the same procedure name and never calls AI, so a
  // generic 'apply' keyword would incorrectly recategorize it too.
  if (p === 'portal.applytovacancy') return 'ai';
  // AI-related endpoints
  if (AI_PATH_KEYWORDS.some((k) => p.includes(k))) return 'ai';
  // Export endpoints
  if (p.includes('export')) return 'export';
  // Default by type
  return type;
}
