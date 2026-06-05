// Sentry init for the Edge runtime (middleware, edge routes). No-ops unless
// SENTRY_DSN is set. Loaded from instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
