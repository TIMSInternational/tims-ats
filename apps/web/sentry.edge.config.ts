// Sentry init for the Edge runtime (middleware, edge routes). No-ops unless
// SENTRY_DSN is set. Loaded from instrumentation.ts.
import * as Sentry from '@sentry/nextjs';
import { redactSentryEvent } from './lib/sentry-redact';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  // 100% traces in dev, 10% in prod (Sentry's recommended Next.js baseline).
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // HR/ATS app (CLAUDE.md §7): no PII off-box.
  sendDefaultPii: false,
  // The candidate interview-join URL carries a bearer token in its path: scrub it from every event.
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
});
