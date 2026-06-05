// Sentry init for the Edge runtime (middleware, edge routes). No-ops unless
// SENTRY_DSN is set. Loaded from instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  // 100% traces in dev, 10% in prod (Sentry's recommended Next.js baseline).
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // HR/ATS app (CLAUDE.md §7): no PII off-box.
  sendDefaultPii: false,
});
