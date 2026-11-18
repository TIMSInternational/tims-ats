import { beforeEach, describe, expect, it, vi } from 'vitest';

// C-11: an opt-in, default-off, neutral rejection notice. It never carries the reason or the internal note,
// replies to the organization's own candidate contact, and is never sent to a candidate who revoked the
// data-processing authorization.

const m = vi.hoisted(() => ({
  findForNotification: vi.fn(),
  isConsentWithdrawn: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/rejection-email.repository', () => ({
  rejectionEmailRepository: { findForNotification: m.findForNotification, isConsentWithdrawn: m.isConsentWithdrawn },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: m.sendEmail }));

import { renderRejectionEmail } from '../../packages/api/src/services/rejection-email-template';
import { rejectionEmailService } from '../../packages/api/src/services/rejection-email.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const APP = '33333333-3333-4333-8333-333333333333';

function notification(overrides: Record<string, unknown> = {}) {
  return {
    application: {
      status: 'rejected',
      candidate: { id: 'c1', firstName: 'María', email: 'maria@example.test', deletedAt: null },
      vacancy: { title: 'Analista Financiero', company: { language: 'es' } },
    },
    org: { name: 'Institución Piloto', billingEmail: 'facturas@example.test', settings: { candidateContactEmail: 'Talento@Example.test' } },
    candidateConsentWithdrawn: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.sendEmail.mockResolvedValue(true);
});

describe('renderRejectionEmail', () => {
  const base = {
    candidateName: 'María',
    vacancyTitle: 'Analista Financiero',
    companyName: 'Institución Piloto',
    locale: 'es' as const,
    contactEmail: 'talento@example.test',
  };

  it('is neutral, in usted, and says the process continued with other profiles', () => {
    const { subject, html } = renderRejectionEmail(base);
    expect(subject).toBe('Actualización de su postulación — Analista Financiero');
    expect(html).toContain('Estimado/a María,');
    expect(html).toContain('el proceso de selección continuó con otros perfiles');
    expect(html).toContain('su postulación');
    expect(html).toContain('mailto:talento@example.test');
    expect(html).not.toMatch(/\btu\b|\bte\b|aplicación/);
  });

  it('escapes every dynamic value and drops a name that is not a plain personal name', () => {
    const { subject, html } = renderRejectionEmail({
      ...base,
      candidateName: 'visite evil.com',
      vacancyTitle: '<script>x</script>\r\nBcc: a@b.c',
      companyName: 'A & B',
    });
    expect(html).toContain('Estimado/a candidato/a,');
    expect(html).not.toContain('evil.com');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('omits the contact line without a contact and has an English version', () => {
    expect(renderRejectionEmail({ ...base, contactEmail: null }).html).not.toContain('mailto:');
    const en = renderRejectionEmail({ ...base, locale: 'en' });
    expect(en.subject).toBe('An update on your application — Analista Financiero');
    expect(en.html).toContain('continued with other profiles');
  });
});

describe('rejectionEmailService.notificationOutcome', () => {
  it('queues the notice for a candidate who may be contacted', async () => {
    m.isConsentWithdrawn.mockResolvedValue(false);
    expect(await rejectionEmailService.notificationOutcome(ORG, 'c1')).toBe('queued');
  });

  it('reports a revoked authorization instead of queueing', async () => {
    m.isConsentWithdrawn.mockResolvedValue(true);
    expect(await rejectionEmailService.notificationOutcome(ORG, 'c1')).toBe('consent_withdrawn');
  });

  it('fails closed (nothing queued) when the consent read fails or the candidate is unknown', async () => {
    m.isConsentWithdrawn.mockRejectedValue(new Error('db down'));
    expect(await rejectionEmailService.notificationOutcome(ORG, 'c1')).toBe('failed');
    expect(await rejectionEmailService.notificationOutcome(ORG, null)).toBe('failed');
  });
});

describe('rejectionEmailService.send', () => {
  it('sends to the candidate with Reply-To the organization candidate contact', async () => {
    m.findForNotification.mockResolvedValue(notification());
    expect(await rejectionEmailService.send(ORG, APP)).toBe(true);
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    const args = m.sendEmail.mock.calls[0]![0] as { to: string; replyTo: string; subject: string; html: string };
    expect(args.to).toBe('maria@example.test');
    expect(args.replyTo).toBe('talento@example.test');
    expect(args.html).toContain('Institución Piloto');
  });

  it('falls back to the billing email and never to a vendor mailbox', async () => {
    m.findForNotification.mockResolvedValue(
      notification({ org: { name: 'X', billingEmail: null, settings: {} } }),
    );
    await rejectionEmailService.send(ORG, APP);
    const args = m.sendEmail.mock.calls[0]![0] as { replyTo: string | null; html: string };
    expect(args.replyTo).toBeNull();
    expect(args.html).not.toContain('mailto:');
    expect(args.html).not.toMatch(/timsinternational|timssuite/i);
  });

  it.each([
    ['the application is no longer rejected', { application: { ...notification().application, status: 'active' } }],
    ['the candidate revoked the authorization', { candidateConsentWithdrawn: true }],
    ['the candidate record was deleted', { application: { ...notification().application, candidate: { id: 'c1', firstName: 'M', email: 'm@example.test', deletedAt: new Date() } } }],
  ])('sends nothing when %s', async (_label, overrides) => {
    m.findForNotification.mockResolvedValue(notification(overrides));
    expect(await rejectionEmailService.send(ORG, APP)).toBe(false);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    m.findForNotification.mockRejectedValue(new Error('boom'));
    await expect(rejectionEmailService.send(ORG, APP)).resolves.toBe(false);
  });

  // The notice is in the language the candidate applied in (consent evidence), else the company's.
  it('writes in the language the candidate applied in, over the company language', async () => {
    m.findForNotification.mockResolvedValue(notification({ candidateLocale: 'en' }));
    await rejectionEmailService.send(ORG, APP);
    const args = m.sendEmail.mock.calls[0]![0] as { subject: string };
    expect(args.subject).toBe('An update on your application — Analista Financiero');
  });

  it('falls back to the company language when the candidate locale is unknown', async () => {
    const english = { ...notification().application, vacancy: { title: 'Analista Financiero', company: { language: 'en-US' } } };
    m.findForNotification.mockResolvedValue(notification({ application: english, candidateLocale: null }));
    await rejectionEmailService.send(ORG, APP);
    expect((m.sendEmail.mock.calls[0]![0] as { subject: string }).subject).toMatch(/^An update on your application/);

    m.sendEmail.mockClear();
    m.findForNotification.mockResolvedValue(notification({ candidateLocale: null }));
    await rejectionEmailService.send(ORG, APP);
    expect((m.sendEmail.mock.calls[0]![0] as { subject: string }).subject).toMatch(/^Actualización de su postulación/);
  });
});
