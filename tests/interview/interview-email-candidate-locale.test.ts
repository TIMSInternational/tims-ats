import { describe, expect, it, vi } from 'vitest';

// Candidate interview emails are in the language the candidate applied in (the consent evidence's locale,
// `candidateLocale`), else the vacancy company's language. Evaluators keep their own user locale.

vi.mock('@tims/db', () => ({ tenantDb: {}, runWithTenant: (_o: string, fn: () => unknown) => fn() }));
vi.mock('../../packages/api/src/repositories/interview-email.repository', () => ({
  interviewEmailRepository: { findForNotification: vi.fn() },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({
  sendRawEmail: vi.fn(),
  sendEmail: vi.fn(),
  getEmailFromAddress: () => 'TIMS <noreply@tims.example>',
}));

import { buildInterviewEmails } from '../../packages/api/src/services/interview-email.service';
import { renderInterviewEmail } from '../../packages/api/src/services/interview-email-templates';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INTERVIEW_ID = '22222222-2222-4222-8222-222222222222';

function data(candidateLocale: string | null | undefined, companyLanguage: string) {
  return {
    org: { name: 'Institución Piloto', billingEmail: null, settings: { timezone: 'America/Costa_Rica' } },
    candidateLocale,
    interview: {
      id: INTERVIEW_ID,
      type: 'onsite',
      status: 'scheduled',
      scheduledAt: new Date('2026-11-10T16:00:00Z'),
      duration: 60,
      location: 'Oficina central — Sala 3',
      meetingUrl: null,
      cancelReason: null,
      updatedAt: new Date('2026-11-02T10:00:00Z'),
      applicationId: 'app-1',
      candidate: { id: 'c-1', firstName: 'Ana', lastName: 'Mora', email: 'ana@example.com' },
      vacancy: { title: 'Analista', company: { language: companyLanguage, timezone: 'America/Costa_Rica' } },
      evaluators: [
        {
          user: {
            id: 'e1',
            firstName: 'Eva',
            lastName: 'Rojas',
            email: 'eva@example.test',
            locale: 'es',
            timezone: 'America/Costa_Rica',
            isActive: true,
          },
        },
      ],
    },
  };
}

function subjects(candidateLocale: string | null | undefined, companyLanguage: string) {
  const { messages } = buildInterviewEmails(
    data(candidateLocale, companyLanguage) as never,
    { orgId: ORG_ID, interviewId: INTERVIEW_ID, kind: 'invite' } as never,
    'https://ats.example.test',
  );
  const by = (audience: string) => messages.find((m) => m.audience === audience)?.subject;
  return { candidate: by('candidate'), evaluator: by('evaluator') };
}

const subjectIn = (locale: 'es' | 'en', audience: 'candidate' | 'evaluator') =>
  renderInterviewEmail({
    kind: 'invite',
    audience,
    locale,
    timeZone: 'America/Costa_Rica',
    recipientName: 'X',
    candidateName: 'Ana Mora',
    vacancyTitle: 'Analista',
    companyName: 'Institución Piloto',
    interviewType: 'onsite',
    scheduledAt: new Date('2026-11-10T16:00:00Z'),
    duration: 60,
    location: null,
    meetingUrl: null,
    joinUrl: null,
    scorecardUrl: null,
    oldScheduledAt: null,
    cancelReason: null,
    contactEmail: null,
  } as never).subject;

describe('interview email — candidate language', () => {
  it('the English and Spanish candidate subjects differ (the assertions below can tell them apart)', () => {
    expect(subjectIn('en', 'candidate')).not.toBe(subjectIn('es', 'candidate'));
  });

  it('writes to the candidate in the language they applied in, over the company language', () => {
    const s = subjects('en', 'es');
    expect(s.candidate).toBe(subjectIn('en', 'candidate'));
    expect(s.evaluator).toBe(subjectIn('es', 'evaluator'));
  });

  it('falls back to the company language when the candidate locale is unknown', () => {
    expect(subjects(null, 'en-US').candidate).toBe(subjectIn('en', 'candidate'));
    expect(subjects(undefined, 'es').candidate).toBe(subjectIn('es', 'candidate'));
  });
});
