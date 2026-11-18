import { describe, it, expect } from 'vitest';
import { createLogger, LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from '../../packages/shared/src/logger';

// The shared pino logger must never write contact details or credentials, whether they sit at the
// top level of the merge object or one level down inside a record that was spread into it.

function capture() {
  const lines: string[] = [];
  const log = createLogger({ write: (line: string) => void lines.push(line) });
  const last = (): Record<string, unknown> => {
    const line = lines.at(-1);
    if (line === undefined) throw new Error('nothing was logged');
    return JSON.parse(line) as Record<string, unknown>;
  };
  return { log, lines, last };
}

describe('shared logger redaction', () => {
  it('redacts top-level email and phone fields', () => {
    const { log, last } = capture();
    log.info({ email: 'ana@example.com', phone: '+50688887777', organizationId: 'org-1' }, 'contact');
    const entry = last();
    expect(entry.email).toBe(LOG_REDACT_CENSOR);
    expect(entry.phone).toBe(LOG_REDACT_CENSOR);
    expect(entry.organizationId).toBe('org-1');
  });

  it('redacts email and phone one level down', () => {
    const { log, last } = capture();
    log.warn({ candidate: { id: 'c-1', email: 'ana@example.com', phone: '+50688887777' } }, 'nested');
    const candidate = last().candidate as Record<string, unknown>;
    expect(candidate).toEqual({ id: 'c-1', email: LOG_REDACT_CENSOR, phone: LOG_REDACT_CENSOR });
  });

  it('redacts the candidate, contact, user and billing variants used across the codebase', () => {
    const { log, lines } = capture();
    log.error(
      {
        candidateEmail: 'a@example.com',
        candidatePhone: '+1 555 0100',
        contactEmail: 'b@example.com',
        userEmail: 'c@example.com',
        actorEmail: 'd@example.com',
        recipientEmail: 'e@example.com',
        billingEmail: 'f@example.com',
        billingPhone: '+1 555 0101',
        emailTo: ['g@example.com'],
        organization: { billingEmail: 'h@example.com', contactEmail: 'i@example.com' },
      },
      'variants',
    );
    const written = lines.join('\n');
    expect(written).not.toMatch(/@example\.com/);
    expect(written).not.toMatch(/555 01/);
  });

  it('keeps redacting credentials', () => {
    const { log, lines } = capture();
    log.info({ password: 'hunter2', authorization: 'Bearer abc', session: { token: 'tok-123' } }, 'creds');
    const written = lines.join('\n');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('Bearer abc');
    expect(written).not.toContain('tok-123');
  });

  it('covers both the top level and one nested level for email and phone', () => {
    for (const path of ['email', 'phone', '*.email', '*.phone']) {
      expect(LOG_REDACT_PATHS).toContain(path);
    }
  });

  it('does not touch fields that only mention email in their name', () => {
    const { log, last } = capture();
    log.info({ emailEnabled: true, recipients: 2 }, 'flags');
    const entry = last();
    expect(entry.emailEnabled).toBe(true);
    expect(entry.recipients).toBe(2);
  });
});
