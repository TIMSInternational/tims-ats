// Sentry init for the Node.js server runtime. No-ops unless SENTRY_DSN is set,
// so local dev and CI (empty DSN) are unaffected. Set SENTRY_DSN in the
// environment to activate. Loaded from instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  // Modest performance-trace sampling; tune once baseline volume is known.
  tracesSampleRate: 0.1,
  // HR data is sensitive — never let Sentry attach IPs, cookies, or request
  // bodies by default. We pass only explicit, non-PII context where needed.
  sendDefaultPii: false,
});
