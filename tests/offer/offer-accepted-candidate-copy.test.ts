import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pilot UX re-audit C-31: after accepting, the candidate gets their own copy of the accepted terms ("usted",
// Costa Rican contract labels) with the next step, and Reply-To is the organization's candidate contact —
// never a vendor mailbox.

const ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OFFER = '99999999-9999-4999-8999-999999999999';

const m = vi.hoisted(() => ({ sendEmail: vi.fn(), findOffer: vi.fn(), findOrganization: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@tims/db', () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn() }));
vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tims/shared')>()),
  logger: { warn: m.warn, error: m.error, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: m.sendEmail }));
vi.mock('../../packages/api/src/repositories/offer-accepted-copy.repository', () => ({
  offerAcceptedCopyRepository: { findOffer: m.findOffer, findOrganization: m.findOrganization },
}));

import { sendOfferAcceptedCopy } from '../../packages/api/src/services/offer-accepted-copy.service';
import { renderOfferAcceptedCopy } from '../../packages/api/src/services/offer-accepted-copy-template';

const ACCEPTED_AT = new Date('2026-11-05T15:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  m.sendEmail.mockResolvedValue(true);
  m.findOffer.mockResolvedValue({
    salary: 10_200_000,
    currency: 'CRC',
    startDate: new Date('2026-12-01T00:00:00Z'),
    contractType: 'termino_fijo',
    respondedAt: ACCEPTED_AT,
    candidate: { firstName: 'María', lastName: 'Pérez', email: 'maria@example.com' },
    vacancy: { title: 'Analista de Datos', company: { timezone: 'America/Costa_Rica' } },
  });
  m.findOrganization.mockResolvedValue({
    name: 'INVU',
    settings: { candidateContactEmail: 'seleccion@invu.example', timezone: 'America/Costa_Rica' },
    billingEmail: 'facturas@invu.example',
  });
});

describe('sendOfferAcceptedCopy', () => {
  it('emails the candidate the accepted terms, Reply-To the organization candidate contact', async () => {
    await sendOfferAcceptedCopy(ORG, OFFER, { at: ACCEPTED_AT, signatureName: 'María Pérez' });
    expect(m.findOffer).toHaveBeenCalledWith(ORG, OFFER);
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    const msg = m.sendEmail.mock.calls[0]![0];
    expect(msg.to).toBe('maria@example.com');
    expect(msg.replyTo).toBe('seleccion@invu.example');
    expect(msg.subject).toBe('Oferta aceptada — Analista de Datos en INVU');
    expect(msg.html).toContain('Plazo fijo');
    expect(msg.html).toContain('1 de diciembre de 2026');
    expect(msg.html).toContain('María Pérez');
    expect(msg.html).toContain('hora de Costa Rica');
    expect(msg.html).toContain('Mi Onboarding');
    expect(msg.html).toContain('mailto:seleccion@invu.example');
    expect(msg.html).not.toMatch(/timsinternational/i);
  });

  it('falls back to the billing email, then to no contact line and no Reply-To', async () => {
    m.findOrganization.mockResolvedValue({ name: 'INVU', settings: {}, billingEmail: 'facturas@invu.example' });
    await sendOfferAcceptedCopy(ORG, OFFER, { at: ACCEPTED_AT, signatureName: null });
    expect(m.sendEmail.mock.calls[0]![0].replyTo).toBe('facturas@invu.example');

    m.findOrganization.mockResolvedValue({ name: 'INVU', settings: {}, billingEmail: null });
    await sendOfferAcceptedCopy(ORG, OFFER, { at: ACCEPTED_AT, signatureName: null });
    const last = m.sendEmail.mock.calls[1]![0];
    expect(last.replyTo).toBeNull();
    expect(last.html).not.toContain('mailto:');
  });

  it('sends nothing (and never throws) when the offer is not accepted or the candidate has no email', async () => {
    m.findOffer.mockResolvedValue(null);
    await expect(sendOfferAcceptedCopy(ORG, OFFER, { at: ACCEPTED_AT, signatureName: null })).resolves.toBeUndefined();
    m.findOffer.mockRejectedValue(new Error('db down'));
    await expect(sendOfferAcceptedCopy(ORG, OFFER, { at: ACCEPTED_AT, signatureName: null })).resolves.toBeUndefined();
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.error).toHaveBeenCalled();
  });
});

describe('renderOfferAcceptedCopy', () => {
  it('leads with the monthly amount in es-CR and escapes candidate-supplied values', () => {
    const { html } = renderOfferAcceptedCopy({
      candidateName: '<script>x</script>',
      vacancyTitle: 'Analista',
      companyName: 'INVU',
      annualSalary: 10_200_000,
      currency: 'CRC',
      startDate: new Date('2026-12-01T00:00:00Z'),
      contractType: 'indefinido',
      signatureName: null,
      acceptedAt: ACCEPTED_AT,
      timeZone: null,
      contactEmail: null,
    });
    expect(html).toMatch(/CRC\s850\s000 al mes/);
    expect(html).toContain('Plazo indefinido');
    expect(html).not.toContain('<script>');
    expect(html).toContain('(UTC)');
  });
});
