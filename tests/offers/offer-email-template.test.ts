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

  it('uses the configured deadline when one exists', () => {
    const { html } = emailTemplates.offerSent({ ...offer, expiresAt: new Date('2026-10-05T15:00:00Z') });
    expect(html).toContain('2026-10-05 15:00 UTC');
  });
});
