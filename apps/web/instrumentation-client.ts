// Browser Sentry init (Next.js runs this client-instrumentation file natively).
// No-ops unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  // 100% traces in dev, 10% in prod (Sentry's recommended Next.js baseline).
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // HR/ATS app (CLAUDE.md §7): never attach IPs/headers/request bodies.
  sendDefaultPii: false,
  // Session Replay is intentionally OFF — recording HR screens risks leaking PII
  // (candidate data, salaries) even with masking. To enable later, add
  // `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })` to
  // `integrations` and raise `replaysOnErrorSampleRate`.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

// App Router navigation instrumentation.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
