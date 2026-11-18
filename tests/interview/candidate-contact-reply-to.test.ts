import { beforeEach, describe, expect, it, vi } from 'vitest';
import { candidateContactEmail } from '../../packages/api/src/services/candidate-contact';
import { buildMimeMessage, MimeHeaderError } from '../../packages/api/src/lib/mime';
import { splitHeaders } from '../helpers/mime-parse';

// C-12: candidate emails name the ORGANIZATION's contact (settings.candidateContactEmail, then
// billingEmail, then nothing) and reply to it. There is no vendor fallback mailbox any more.

const ses = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../packages/api/node_modules/@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = ses.send;
  },
  SendEmailCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
  SendRawEmailCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

describe('candidateContactEmail', () => {
  it('prefers settings.candidateContactEmail, normalised', () => {
    expect(
      candidateContactEmail({
        settings: { candidateContactEmail: ' Talento@Acme.Test ' },
        billingEmail: 'b@acme.test',
      }),
    ).toBe('talento@acme.test');
  });

  it('falls back to the billing email, then to nothing', () => {
    expect(candidateContactEmail({ settings: {}, billingEmail: 'billing@acme.test' })).toBe('billing@acme.test');
    expect(
      candidateContactEmail({ settings: { candidateContactEmail: 'not-an-email' }, billingEmail: null }),
    ).toBeNull();
    expect(candidateContactEmail({ settings: null, billingEmail: null })).toBeNull();
    expect(candidateContactEmail(null)).toBeNull();
  });

  it('never accepts a header-unsafe or list value', () => {
    for (const bad of [
      'a@b.co\r\nBcc: x@y.co',
      '"A" <a@b.co>',
      'a@b.co, c@d.co',
      'a@b.co;c@d.co',
      'x'.repeat(250) + '@b.co',
    ]) {
      expect(candidateContactEmail({ settings: { candidateContactEmail: bad }, billingEmail: null })).toBeNull();
    }
  });
});

describe('Reply-To transport', () => {
  const base = {
    from: 'TIMS <noreply@tims.example>',
    to: 'ana@example.com',
    subject: 'Invitación',
    html: '<p>x</p>',
    text: 'x',
    messageIdDomain: 'tims.example',
  };

  it('the MIME copy carries Reply-To only when one is given, and refuses an unsafe one', () => {
    expect(splitHeaders(buildMimeMessage({ ...base, replyTo: 'talento@acme.test' })).headers).toMatch(
      /^Reply-To: talento@acme\.test$/m,
    );
    expect(splitHeaders(buildMimeMessage(base)).headers).not.toMatch(/^Reply-To:/m);
    expect(() => buildMimeMessage({ ...base, replyTo: 'a@b.co\r\nBcc: x@y.co' })).toThrow(MimeHeaderError);
  });

  beforeEach(() => {
    vi.resetModules();
    ses.send.mockReset().mockResolvedValue({});
  });

  it('the plain SES send sets ReplyToAddresses only for a safe mailbox', async () => {
    const { sendEmail } = await import('../../packages/api/src/lib/ses');
    await sendEmail({ to: 'ana@example.com', subject: 's', html: 'h', replyTo: 'talento@acme.test' });
    await sendEmail({ to: 'ana@example.com', subject: 's', html: 'h' });
    await sendEmail({ to: 'ana@example.com', subject: 's', html: 'h', replyTo: 'a@b.co\nBcc: x@y.co' });
    const inputs = ses.send.mock.calls.map(([command]) => (command as { input: Record<string, unknown> }).input);
    expect(inputs[0]!.ReplyToAddresses).toEqual(['talento@acme.test']);
    expect(inputs[1]).not.toHaveProperty('ReplyToAddresses');
    expect(inputs[2]).not.toHaveProperty('ReplyToAddresses');
  });
});
