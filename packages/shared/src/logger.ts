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
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function createTenantLogger(orgId: string, userId?: string) {
  return logger.child({ orgId, userId });
}
