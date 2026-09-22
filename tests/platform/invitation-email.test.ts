import { describe, expect, it } from 'vitest';
import { renderInvitationEmail } from '../../packages/api/src/services/invitation-email';

const expiresAt = new Date('2026-09-29T12:00:00.000Z');

describe('invitation email', () => {
  it('renders a responsive Spanish account-setup email with escaped data and exact expiry', () => {
    const html = renderInvitationEmail({
      organization: '<TIMS & Co>', role: '<admin>',
      url: 'https://tims.example/accept-invitation?token=abc&source=mail', expiresAt,
    });
    expect(html).toContain('name="viewport"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('Tu próximo paso comienza aquí');
    expect(html).toContain('29 de septiembre de 2026 UTC');
    expect(html).toContain('&lt;TIMS &amp; Co&gt;');
    expect(html).toContain('&lt;admin&gt;');
    expect(html).toContain('href="https://tims.example/accept-invitation?token=abc&amp;source=mail"');
    expect(html).not.toContain('<admin>');
  });

  it('renders an English reminder with the existing-account guidance', () => {
    const html = renderInvitationEmail({ organization: 'TIMS', url: 'https://tims.example/accept-invitation?token=abc', expiresAt, locale: 'en', reminder: true });
    expect(html).toContain('YOUR INVITATION');
    expect(html).toContain('Already have an account? Sign in');
    expect(html).toContain('September 29, 2026 UTC');
  });

  it('rejects untrusted link schemes and credential-bearing URLs', () => {
    for (const url of ['javascript:alert(1)', 'http://evil.example/invite', 'https://user:pass@tims.example/invite']) {
      expect(() => renderInvitationEmail({ organization: 'TIMS', url, expiresAt })).toThrow();
    }
  });

  it('permits a local development link', () => {
    expect(renderInvitationEmail({ organization: 'TIMS', url: 'http://localhost:3100/accept-invitation?token=abc', expiresAt })).toContain('http://localhost:3100/accept-invitation?token=abc');
  });
});
