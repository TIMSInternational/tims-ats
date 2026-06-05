// Sentry init for the Node.js server runtime. No-ops unless SENTRY_DSN is set,
// so local dev and CI (empty DSN) are unaffected. Loaded from instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  // 100% traces in dev, 10% in prod (Sentry's recommended Next.js baseline).
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // HR/ATS app (CLAUDE.md §7): never attach IPs/cookies/request bodies, and do
  // NOT capture local variables — stack frames can hold candidate SSN/salary/
  // medical data. (Both differ from the Sentry skill defaults, by design.)
  sendDefaultPii: false,
  includeLocalVariables: false,
});
