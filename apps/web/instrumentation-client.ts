// Browser Sentry init (Next.js runs this client-instrumentation file natively).
// No-ops unless NEXT_PUBLIC_SENTRY_DSN is set. Session Replay is disabled —
// recording HR screens would capture sensitive PII.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
