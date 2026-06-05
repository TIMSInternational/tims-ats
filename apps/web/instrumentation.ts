// Next.js instrumentation hook. Loads the runtime-appropriate Sentry config and
// wires Sentry's capture for errors thrown in the Next.js request pipeline
// (Server Components, route handlers, etc.). All of this no-ops when SENTRY_DSN
// is unset, so it is safe to ship inert.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
