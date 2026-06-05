import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact sensitive fields
  redact: {
    paths: ['password', 'token', 'secret', 'authorization', 'ssn', 'creditCard', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]',
  },
  // NO transport — ever. pino transports spawn a thread-stream worker whose
  // lib/worker.js cannot be resolved once Next bundles pino (Sentry: "Cannot
  // find module .../thread-stream/lib/worker.js" → "the worker thread exited",
  // fatal on /api/trpc). Plain pino writes JSON lines to stdout synchronously,
  // which is what we want in serverless anyway (CLAUDE.md §8). Pipe through
  // `pino-pretty` on the CLI locally if pretty logs are needed.
});

export function createTenantLogger(orgId: string, userId?: string) {
  return logger.child({ orgId, userId });
}
