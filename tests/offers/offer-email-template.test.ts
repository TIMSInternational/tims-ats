import { describe, expect, it } from 'vitest';
import { emailTemplates } from '../../packages/api/src/services/email-templates.service';

const offer = {
  candidateName: 'QA Candidate',
  vacancyTitle: 'QA role',
  companyName: 'Example Company',
  signingUrl: 'https://example.test/offers/sign/test-token',
};

describe('candidate offer email', () => {
  it('does not invent an expiry date when the offer has none', () => {
    const { html } = emailTemplates.offerSent({ ...offer, expiresAt: null });
    expect(html).toContain(offer.signingUrl);
    expect(html).toContain(offer.companyName);
    expect(html).not.toContain('5 días');
    expect(html).not.toContain('Vigencia:');
  });

  // E-23: the validity date reads in the organization's time zone with its label, not as a UTC slice.
  it("states the deadline in the organization's time zone, labelled", () => {
    const { html } = emailTemplates.offerSent({
      ...offer,
      expiresAt: new Date('2026-10-05T15:00:00Z'),
      timeZone: 'America/Costa_Rica',
    });
    expect(html).toContain('5 de octubre de 2026');
    expect(html).toContain('9:00');
    expect(html).toContain('hora de Costa Rica (GMT-6)');
    expect(html).not.toContain('UTC');
  });

  it('labels a deadline as UTC when the organization has no usable time zone', () => {
    const { html } = emailTemplates.offerSent({ ...offer, expiresAt: new Date('2026-10-05T15:00:00Z'), timeZone: null });
    expect(html).toContain('3:00');
    expect(html).toContain('(UTC)');
  });

  it("names the organization's candidate contact only when it has one", () => {
    const withContact = emailTemplates.offerSent({ ...offer, expiresAt: null, contactEmail: 'talento@example.test' });
    expect(withContact.html).toContain('mailto:talento@example.test');
    const without = emailTemplates.offerSent({ ...offer, expiresAt: null, contactEmail: null });
    expect(without.html).not.toContain('mailto:');
  });
});

describe('staff offer response notices (B-18)', () => {
  const notice = {
    candidateName: 'Ana <b>Mora</b>',
    vacancyTitle: 'Analista',
    companyName: 'Example Company',
    recipientName: 'equipo',
    offerUrl: 'https://example.test/recruitment/offers/abc',
    timeZone: 'America/Costa_Rica',
  };

  it('accepted: links to the offer, names the next step, dates in the org zone, escapes names', () => {
    const { html } = emailTemplates.offerAcceptedNotification({ ...notice, acceptedAt: new Date('2026-11-04T22:51:00Z') });
    expect(html).toContain('https://example.test/recruitment/offers/abc');
    expect(html).toContain('Autorizar contratación');
    expect(html).toContain('4 de noviembre de 2026');
    expect(html).toContain('hora de Costa Rica (GMT-6)');
    expect(html).toContain('Ana &lt;b&gt;Mora&lt;/b&gt;');
    expect(html).not.toContain('<b>Mora</b>');
  });

  it('declined: links to the offer and omits the button without a URL', () => {
    const declined = emailTemplates.offerDeclinedNotification({ ...notice, declinedAt: new Date('2026-11-04T22:51:00Z') });
    expect(declined.html).toContain('https://example.test/recruitment/offers/abc');
    const noLink = emailTemplates.offerDeclinedNotification({
      ...notice,
      offerUrl: null,
      declinedAt: new Date('2026-11-04T22:51:00Z'),
    });
    expect(noLink.html).not.toContain('Abrir la oferta');
  });
});
