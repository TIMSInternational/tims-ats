import { TRPCError } from '@trpc/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limiter. Replace with Redis/Upstash for production multi-instance.
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Mutations are more expensive
  mutation: { windowMs: 60_000, maxRequests: 30 },  // 30 mutations/min
  // Queries are cheaper
  query: { windowMs: 60_000, maxRequests: 100 },     // 100 queries/min
  // Auth endpoints are sensitive
  auth: { windowMs: 300_000, maxRequests: 10 },       // 10 auth attempts/5min
  // AI endpoints are expensive
  ai: { windowMs: 60_000, maxRequests: 10 },          // 10 AI calls/min
  // Export endpoints
  export: { windowMs: 300_000, maxRequests: 5 },      // 5 exports/5min
};

export function checkRateLimit(
  identifier: string,
  category: keyof typeof RATE_LIMITS = 'query'
): void {
  const config = RATE_LIMITS[category];
  const now = Date.now();
  const key = `${category}:${identifier}`;

  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfter} segundos.`,
    });
  }
}

export function getRateLimitCategory(path: string, type: 'query' | 'mutation'): keyof typeof RATE_LIMITS {
  // Auth endpoints
  if (path.startsWith('auth.')) return 'auth';
  // AI-related endpoints
  if (path.includes('generate') || path.includes('parse') || path.includes('analyze') || path.includes('Explainability') || path.includes('Recommendations') || path.includes('NextBestAction') || path.includes('detectBias') || path.includes('simulate')) return 'ai';
  // Export endpoints
  if (path.includes('export') || path.includes('Export')) return 'export';
  // Default by type
  return type;
}
