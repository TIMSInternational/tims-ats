import { createHash } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from '@tims/shared';

// ---------------------------------------------------------------------------
// Upstash Redis (production) — falls back to in-memory only outside production.
// Vercel functions do not share process memory. A missing URL/token in production
// would silently disable auth, AI and application-email limits across instances.
// ---------------------------------------------------------------------------
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const hasUpstashUrl = Boolean(upstashUrl);
const hasUpstashToken = Boolean(upstashToken);

if (hasUpstashUrl !== hasUpstashToken) {
  throw new Error('Rate limiting requires both Upstash REST environment variables');
}
if (process.env.VERCEL_ENV === 'production' && !hasUpstashUrl) {
  throw new Error('Production rate limiting requires shared Upstash Redis');
}

const redis =
  upstashUrl && upstashToken
    ? new Redis({
        url: upstashUrl,
        token: upstashToken,
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

export type RateLimitCategory = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// Outage policy. Every shared-store call is bounded to SHARED_LIMIT_TIMEOUT_MS so a
// slow or unreachable Upstash cannot stall every request (the SDK default is 5s,
// which turned an Upstash outage into a whole-app 503 after ~5s per request).
//
// When the shared store is unavailable (timeout or error):
//  - FAIL CLOSED (SERVICE_UNAVAILABLE) for the tiers where an unlimited burst is the
//    attack or the cost: `auth`, `ai`, `export`, and the credential-like paths in
//    FAIL_CLOSED_PATHS (invitation token, password reset, offer-signing token), which
//    the tRPC middleware identifies by passing the procedure `path`. Login and MFA are performed by Supabase Auth directly,
//    not through tRPC, so they are not governed by this limiter at all.
//  - FAIL OPEN to the per-instance in-memory limiter for everything else
//    (ordinary `query` / `mutation`), with a structured warning so the degradation
//    is observable. The per-instance limiter still bounds a single instance.
// ---------------------------------------------------------------------------
export const SHARED_LIMIT_TIMEOUT_MS = 1_000;

const FAIL_CLOSED_CATEGORIES: ReadonlySet<RateLimitCategory> = new Set(['auth', 'ai', 'export']);

// Lower-cased full tRPC paths of credential-like procedures that live outside `auth.*`.
// Their tier (and therefore their limit) is unchanged; only the outage policy differs.
const FAIL_CLOSED_PATHS: ReadonlySet<string> = new Set([
  'platform.acceptinvitation',
  'platform.getinvitationbytoken',
  'platform.resetuserpassword',
  'offer.acceptbytoken',
  'offer.declinebytoken',
  'offer.getbysigningtoken',
]);

/** True when a shared-store outage must reject this path instead of degrading. */
export function isFailClosedPath(path: string): boolean {
  return FAIL_CLOSED_PATHS.has(path.toLowerCase());
}

class SharedLimiterTimeoutError extends Error {
  constructor() {
    super('Shared rate limiter timed out');
    this.name = 'SharedLimiterTimeoutError';
  }
}

/** Races a limiter call against a hard deadline; the timer never outlives the call. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SharedLimiterTimeoutError()), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// One warning per category+mode per interval, with a count of the suppressed ones, so an
// outage is visible without one log line per request. Never logs the identifier (user id
// or client IP), the request, or the raw error message (it can echo the Redis URL).
const OUTAGE_LOG_INTERVAL_MS = 10_000;
const outageLog = new Map<string, { lastAt: number; suppressed: number }>();

function logSharedLimiterOutage(
  category: RateLimitCategory,
  failClosed: boolean,
  cause: 'timeout' | 'error',
  err: unknown,
): void {
  const mode = failClosed ? 'fail_closed' : 'fail_open_memory';
  const key = `${category}:${mode}`;
  const now = Date.now();
  const state = outageLog.get(key);
  if (state && now - state.lastAt < OUTAGE_LOG_INTERVAL_MS) {
    state.suppressed++;
    return;
  }
  logger.warn(
    {
      event: 'ratelimit.shared_store_unavailable',
      category,
      mode,
      cause,
      errorName: err instanceof Error ? err.name : typeof err,
      suppressedSinceLast: state?.suppressed ?? 0,
    },
    'Shared rate-limit store unavailable',
  );
  outageLog.set(key, { lastAt: now, suppressed: 0 });
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
    timeout: SHARED_LIMIT_TIMEOUT_MS,
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
  category: RateLimitCategory = 'query',
  options: { path?: string } = {},
): Promise<void> {
  const upstash = upstashLimiters[category];

  if (upstash) {
    let result: Awaited<ReturnType<Ratelimit['limit']>> | undefined;
    let outage: { cause: 'timeout' | 'error'; err: unknown } | undefined;
    try {
      result = await withDeadline(upstash.limit(identifier), SHARED_LIMIT_TIMEOUT_MS);
      // The SDK reports success with reason 'timeout' when its own deadline expires.
      // That is NOT an allowance — it means the shared store did not answer.
      if (result.reason === 'timeout') outage = { cause: 'timeout', err: new SharedLimiterTimeoutError() };
    } catch (err) {
      outage = { cause: err instanceof SharedLimiterTimeoutError ? 'timeout' : 'error', err };
    }

    if (outage || !result) {
      outage ??= { cause: 'error', err: undefined };
      const failClosed =
        FAIL_CLOSED_CATEGORIES.has(category) || (options.path !== undefined && isFailClosedPath(options.path));
      logSharedLimiterOutage(category, failClosed, outage.cause, outage.err);
      if (failClosed) {
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'El límite de solicitudes no está disponible.' });
      }
      // Fail open to the per-instance limiter: still bounded per function instance.
      checkMemoryRateLimit(identifier, category);
      return;
    }

    const { success, reset } = result;
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
      timeout: SHARED_LIMIT_TIMEOUT_MS,
    })
  : null;

const applicationEmailMemory = new Map<string, number>();

export async function consumeApplicationEmailQuota(recipientEmail: string): Promise<boolean> {
  const key = createHash('sha256').update(recipientEmail.trim().toLowerCase()).digest('hex');
  if (applicationEmailLimiter) {
    const { success, reason } = await withDeadline(applicationEmailLimiter.limit(key), SHARED_LIMIT_TIMEOUT_MS);
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
