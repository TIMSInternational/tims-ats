import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

// Credentials and other secrets: redacted at the top level and one level down.
const SECRET_KEYS = ['password', 'token', 'secret', 'authorization', 'ssn', 'creditCard'] as const;
const NESTED_SECRET_KEYS = ['password', 'token', 'secret'] as const;

// Contact details (personal data): the email/phone key names used across this codebase, each redacted
// at the top level and one level down (`{ candidate: { email } }`). Deeper nesting is not covered, so
// log identifiers rather than whole records. Add a key here when a new contact field name appears.
const CONTACT_KEYS = [
  'email',
  'phone',
  'candidateEmail',
  'candidatePhone',
  'contactEmail',
  'contactPhone',
  'candidateContactEmail',
  'userEmail',
  'actorEmail',
  'adminEmail',
  'hrEmail',
  'recipientEmail',
  'attendeeEmail',
  'organizerEmail',
  'targetEmail',
  'billingEmail',
  'billingPhone',
  'emailTo',
  'emailCc',
] as const;

/** Every path the shared logger censors. Exported so tests pin the list. */
export const LOG_REDACT_PATHS: readonly string[] = [
  ...SECRET_KEYS,
  ...NESTED_SECRET_KEYS.map((key) => `*.${key}`),
  ...CONTACT_KEYS,
  ...CONTACT_KEYS.map((key) => `*.${key}`),
];

export const LOG_REDACT_CENSOR = '[REDACTED]';

/**
 * Builds a logger with the shared configuration. `destination` exists for tests; production code
 * uses the `logger` singleton below, which writes to stdout.
 */
export function createLogger(destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: LOG_REDACT_CENSOR,
    },
    // NO transport — ever. pino transports spawn a thread-stream worker whose
    // lib/worker.js cannot be resolved once Next bundles pino (Sentry: "Cannot
    // find module .../thread-stream/lib/worker.js" → "the worker thread exited",
    // fatal on /api/trpc). Plain pino writes JSON lines to stdout synchronously,
    // which is what we want in serverless anyway (CLAUDE.md §8). Pipe through
    // `pino-pretty` on the CLI locally if pretty logs are needed.
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export function createTenantLogger(orgId: string, userId?: string) {
  return logger.child({ orgId, userId });
}
