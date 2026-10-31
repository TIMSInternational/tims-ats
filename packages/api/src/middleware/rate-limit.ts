import { createHash } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { logger } from '@tims/shared';

import {
  SHARED_LIMIT_TIMEOUT_MS,
  SharedLimiterTimeoutError,
  createSharedStore,
  readSharedStoreConfig,
} from './rate-limit-store';

export { SHARED_LIMIT_TIMEOUT_MS };

// ---------------------------------------------------------------------------
// Shared store (DynamoDB, see rate-limit-store.ts) — falls back to in-memory only outside
// production. Vercel functions do not share process memory. A missing table in production
// would silently disable auth, AI and application-email limits across instances.
// ---------------------------------------------------------------------------
const sharedStoreConfig = readSharedStoreConfig(process.env);

if (process.env.VERCEL_ENV === 'production' && !sharedStoreConfig) {
  throw new Error('Production rate limiting requires the shared DynamoDB table (RATE_LIMIT_DYNAMODB_TABLE)');
}

const sharedStore = sharedStoreConfig ? createSharedStore(sharedStoreConfig) : undefined;

// ---------------------------------------------------------------------------
// Rate-limit definitions per category
// ---------------------------------------------------------------------------
export const LIMITS = {
  mutation: { requests: 30, window: '1m' as const }, // 30 mutations/min
  query: { requests: 300, window: '1m' as const }, // 300 queries/min (one budget across both stacks)
  auth: { requests: 10, window: '5m' as const }, // 10 auth attempts/5min
  ai: { requests: 10, window: '1m' as const }, // 10 AI calls/min
  export: { requests: 5, window: '5m' as const }, // 5 exports/5min
} as const;

export type RateLimitCategory = keyof typeof LIMITS;

// ---------------------------------------------------------------------------
// Outage policy. Every shared-store call is bounded to SHARED_LIMIT_TIMEOUT_MS (the in-flight
// request is aborted at the deadline) so a slow or unreachable store cannot stall every request.
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
const FAIL_CLOSED_CATEGORIES: ReadonlySet<RateLimitCategory> = new Set(['auth', 'ai', 'export']);

// Lower-cased full tRPC paths of credential-like procedures that live outside `auth.*`:
// every public procedure whose input carries a bearer token (tests/ratelimit/
// fail-closed-token-coverage.test.ts scans the routers and fails if one is missing), plus the
// operator password reset. Their tier (and limit) is unchanged; only the outage policy differs.
const FAIL_CLOSED_PATHS: ReadonlySet<string> = new Set([
  'platform.acceptinvitation',
  'platform.getinvitationbytoken',
  'platform.resetuserpassword',
  'offer.acceptbytoken',
  'offer.declinebytoken',
  'offer.getbysigningtoken',
  'aiinterview.recordconsent',
  'aiinterview.start',
]);

/** True when a shared-store outage must reject this path instead of degrading. */
export function isFailClosedPath(path: string): boolean {
  return FAIL_CLOSED_PATHS.has(path.toLowerCase());
}

// One warning per category+mode per interval, with a count of the suppressed ones, so an
// outage is visible without one log line per request. Never logs the identifier (user id
// or client IP), the request, or the raw error message (it can echo the table ARN or account).
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
  if (sharedStore) {
    const { requests, window } = LIMITS[category];
    let result: { success: boolean; reset: number } | undefined;
    let outage: { cause: 'timeout' | 'error'; err: unknown } | undefined;
    try {
      result = await sharedStore.slidingWindow(`rl#${category}`, identifier, requests, windowToMs(window));
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
// address per 24h (rolling), platform-wide. The key is sha256(lowercased address) — the raw
// address never reaches the shared store or memory keys.
// Returns true only when a send is allowed. A shared-store timeout or error propagates and
// the caller must treat it as NOT allowed (fail closed — skip the email).
// ---------------------------------------------------------------------------
const APPLICATION_EMAIL_WINDOW_MS = 86_400_000;

const applicationEmailMemory = new Map<string, number>();

export async function consumeApplicationEmailQuota(recipientEmail: string): Promise<boolean> {
  const key = createHash('sha256').update(recipientEmail.trim().toLowerCase()).digest('hex');
  if (sharedStore) return sharedStore.claimOnce('ae', key, APPLICATION_EMAIL_WINDOW_MS);
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
