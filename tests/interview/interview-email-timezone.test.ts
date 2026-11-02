import { describe, expect, it, vi } from 'vitest';

// Pilot fix: interview emails must show the time in the organization's configured timezone
// (organizations.settings.timezone), not the America/Bogota fallback. Vacancies carry no company in
// practice and users.timezone defaults to Bogota for everyone, so before this fix a 10:00 Costa Rica
// interview read "11:00" in the email body.

vi.mock('@tims/db', () => ({ tenantDb: {}, runWithTenant: (_o: string, fn: () => unknown) => fn() }));
vi.mock('../../packages/api/src/repositories/interview-email.repository', () => ({
  interviewEmailRepository: { findForNotification: vi.fn() },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({
  sendRawEmail: vi.fn(),
  sendEmail: vi.fn(),
  getEmailFromAddress: () => 'TIMS <noreply@tims.example>',
}));

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INTERVIEW_ID = '22222222-2222-4222-8222-222222222222';
const APP = 'https://ats.example.test';
// 16:00 UTC = 10:00 in Costa Rica (UTC-6, no DST) = 11:00 in Bogota (UTC-5).
const SCHEDULED = new Date('2026-11-10T16:00:00Z');

function data(settings: unknown, companyTz: string | null = null) {
  return {
    org: { name: 'INVU', billingEmail: 'rrhh@invu.test', settings },
    interview: {
      id: INTERVIEW_ID,
      type: 'onsite',
      status: 'scheduled',
      scheduledAt: SCHEDULED,
      duration: 60,
      location: 'Oficinas centrales',
      meetingUrl: null,
      cancelReason: null,
      updatedAt: new Date('2026-11-02T10:00:00Z'),
      candidate: { firstName: 'Ana', lastName: 'Mora', email: 'ana@example.com' },
      vacancy: { title: 'Analista', company: companyTz ? { language: 'es', timezone: companyTz } : null },
      evaluators: [
        {
          user: {
            id: 'e1',
            firstName: 'Eva',
            lastName: 'Rojas',
            email: 'eva@invu.test',
            locale: 'es',
            timezone: 'America/Bogota', // the column default every user gets
            isActive: true,
          },
        },
      ],
    },
  };
}

async function build(settings: unknown, companyTz: string | null = null) {
  const { buildInterviewEmails } = await import('../../packages/api/src/services/interview-email.service');
  return buildInterviewEmails(
    data(settings, companyTz) as never,
    { orgId: ORG_ID, interviewId: INTERVIEW_ID, kind: 'invite' } as never,
    APP,
  );
}

describe('interview email timezone', () => {
  it('uses the organization timezone for the candidate and evaluators', async () => {
    const { messages, skipped } = await build({ timezone: 'America/Costa_Rica' });
    expect(skipped).toBe(0);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.text).toMatch(/10:00/);
      expect(message.text).not.toMatch(/11:00/);
    }
  });

  it('prefers the organization timezone over a vacancy company timezone', async () => {
    const { messages } = await build({ timezone: 'America/Costa_Rica' }, 'America/Bogota');
    expect(messages.every((message) => /10:00/.test(message.text))).toBe(true);
  });

  it('keeps the previous fallbacks when the organization has no timezone', async () => {
    const { messages } = await build({});
    expect(messages.every((message) => /11:00/.test(message.text))).toBe(true);
  });

  it('ignores an invalid or non-string timezone setting', async () => {
    for (const settings of [{ timezone: 'Mars/Olympus' }, { timezone: 42 }, null, [], 'x']) {
      const { messages } = await build(settings);
      expect(messages.every((message) => /11:00/.test(message.text))).toBe(true);
    }
  });

  it('orgTimeZone accepts only valid IANA zones', async () => {
    const { orgTimeZone } = await import('../../packages/api/src/services/interview-email.service');
    expect(orgTimeZone({ timezone: 'America/Costa_Rica' })).toBe('America/Costa_Rica');
    expect(orgTimeZone({ timezone: '' })).toBeNull();
    expect(orgTimeZone({ timezone: 'x'.repeat(65) })).toBeNull();
    expect(orgTimeZone(undefined)).toBeNull();
  });
});
