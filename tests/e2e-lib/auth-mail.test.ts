import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertLocalUrl,
  extractAuthLink,
  extractOtp,
  parseMailpitList,
  parseMailpitMessage,
  pickLatestFor,
  waitForAuthMail,
  type MailpitMessage,
} from '../../e2e/lib/auth-mail';

/**
 * Supabase auth mail (OTP codes, magic links, signup confirmations) lands in the local stack's
 * Mailpit inbox. These tests run the pure parsing side against a saved, made-up Mailpit sample,
 * and pin the safety rule: a link that leaves localhost is refused, never followed.
 */

interface Sample {
  list: unknown;
  messages: Record<string, unknown>;
}

const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mailpit-messages.json'), 'utf8')) as Sample;
const message = (id: string): MailpitMessage => parseMailpitMessage(sample.messages[id]);

describe('parseMailpitList / parseMailpitMessage', () => {
  it('parses every summary in the list response', () => {
    const list = parseMailpitList(sample.list);
    expect(list.map((m) => m.id)).toEqual([
      'msg-other-recipient',
      'msg-offsite-link',
      'msg-magic-link',
      'msg-otp-new',
      'msg-otp-old',
    ]);
    expect(list[3]).toMatchObject({
      to: ['carlos.candidato@vivienda-e2e.test'],
      subject: 'Tu código de acceso',
    });
    expect(list[3]?.created.toISOString()).toBe('2026-10-28T15:01:00.000Z');
  });

  it('parses a full message with text and html bodies', () => {
    const m = message('msg-otp-new');
    expect(m.id).toBe('msg-otp-new');
    expect(m.to).toEqual(['carlos.candidato@vivienda-e2e.test']);
    expect(m.text).toContain('482915');
    expect(m.html).toContain('<strong>482915</strong>');
  });

  it.each([
    ['null', null],
    ['a string', 'messages'],
    ['no messages array', { total: 0 }],
    ['a summary without ID', { messages: [{ To: [], Subject: 'x', Created: '2026-10-28T15:00:00Z' }] }],
    ['a bad Created date', { messages: [{ ID: 'a', To: [], Subject: 'x', Created: 'yesterday' }] }],
  ])('rejects a list response that is %s', (_label, bad) => {
    expect(() => parseMailpitList(bad)).toThrow(/mailpit/i);
  });

  it.each([
    ['null', null],
    ['missing ID', { To: [], Subject: 'x', Text: '', HTML: '' }],
    ['a non-array To', { ID: 'a', To: 'a@b.test', Subject: 'x', Text: '', HTML: '' }],
  ])('rejects a message response with %s', (_label, bad) => {
    expect(() => parseMailpitMessage(bad)).toThrow(/mailpit/i);
  });
});

describe('pickLatestFor', () => {
  const list = parseMailpitList(sample.list);

  it('returns the newest message for the recipient, ignoring list order', () => {
    expect(pickLatestFor(list, 'carlos.candidato@vivienda-e2e.test')?.id).toBe('msg-otp-new');
    expect(pickLatestFor([...list].reverse(), 'carlos.candidato@vivienda-e2e.test')?.id).toBe('msg-otp-new');
  });

  it('matches the address case-insensitively', () => {
    expect(pickLatestFor(list, 'ana.candidata@VIVIENDA-E2E.test')?.id).toBe('msg-magic-link');
  });

  it('never returns another recipient’s mail', () => {
    expect(pickLatestFor(list, 'nobody@vivienda-e2e.test')).toBeUndefined();
    expect(pickLatestFor(list, 'candidato@vivienda-e2e.test')).toBeUndefined();
  });

  it('skips mail created before `since` (a stale OTP is never reused)', () => {
    const since = new Date('2026-10-28T14:58:00.000Z');
    expect(pickLatestFor(list, 'carlos.candidato@vivienda-e2e.test', since)?.id).toBe('msg-otp-new');
    expect(
      pickLatestFor(list, 'carlos.candidato@vivienda-e2e.test', new Date('2026-10-28T15:05:00.000Z')),
    ).toBeUndefined();
  });
});

describe('extractOtp', () => {
  it('extracts the 6-digit code, not the year or the minutes', () => {
    expect(extractOtp(message('msg-otp-new'))).toBe('482915');
  });

  it('falls back to the html body when the text part is empty', () => {
    const m = { ...message('msg-otp-new'), text: '' };
    expect(extractOtp(m)).toBe('482915');
  });

  it('does not read digits out of a token inside a link', () => {
    expect(() => extractOtp(message('msg-magic-link'))).toThrow(/no .*code/i);
  });

  it('ignores digit runs inside a bare URL in the text body', () => {
    const link = 'http://127.0.0.1:54321/auth/v1/verify?token=730418&type=magiclink';
    const withCode = { ...message('msg-otp-new'), text: `Tu código es 482915. O ingresa: ${link}`, html: '' };
    expect(extractOtp(withCode)).toBe('482915');
    const linkOnly = { ...message('msg-otp-new'), text: `Ingresa: ${link}`, html: '' };
    expect(() => extractOtp(linkOnly)).toThrow(/no .*code/i);
  });

  it('throws when two different codes appear (ambiguous mail is a test bug, not a guess)', () => {
    const m = { ...message('msg-otp-new'), text: 'Código 482915. Código anterior 103774.' };
    expect(() => extractOtp(m)).toThrow(/ambiguous|more than one/i);
  });

  it('accepts the same code repeated (text and html usually both carry it)', () => {
    const m = { ...message('msg-otp-new'), text: 'Código 482915 (482915)' };
    expect(extractOtp(m)).toBe('482915');
  });

  it('supports an 8-digit code length when asked', () => {
    const m = { ...message('msg-otp-new'), text: 'Tu código es 12345678', html: '' };
    expect(extractOtp(m, { digits: 8 })).toBe('12345678');
    expect(() => extractOtp(m)).toThrow(/no .*code/i);
  });
});

describe('extractAuthLink', () => {
  it('returns the Supabase verify link, decoding &amp; and skipping unrelated links', () => {
    const url = extractAuthLink(message('msg-magic-link'));
    expect(url.origin).toBe('http://127.0.0.1:54321');
    expect(url.pathname).toBe('/auth/v1/verify');
    expect(url.searchParams.get('type')).toBe('magiclink');
    expect(url.searchParams.get('redirect_to')).toBe('http://localhost:3000/es/portal');
  });

  it('refuses a verify link whose host is not localhost', () => {
    expect(() => extractAuthLink(message('msg-offsite-link'))).toThrow(/localhost|local/i);
  });

  it('refuses a local verify link whose redirect_to leaves localhost', () => {
    const html =
      '<a href="http://127.0.0.1:54321/auth/v1/verify?token=x&amp;type=magiclink&amp;redirect_to=https://evil.example/">x</a>';
    const m = { ...message('msg-magic-link'), html };
    expect(() => extractAuthLink(m)).toThrow(/redirect_to/i);
  });

  it('throws when the mail has no verify link at all', () => {
    expect(() => extractAuthLink(message('msg-otp-new'))).toThrow(/no .*link/i);
  });
});

describe('assertLocalUrl', () => {
  it.each([
    'http://localhost:3000/es',
    'http://127.0.0.1:54321/auth/v1/verify',
    'http://[::1]:54324/api/v1/messages',
    'https://localhost/',
  ])('accepts %s', (raw) => {
    expect(assertLocalUrl(raw).href).toBe(new URL(raw).href);
  });

  it.each([
    'https://auth.vivienda-e2e.test/auth/v1/verify',
    'http://localhost.evil.example/',
    'http://127.0.0.1.evil.example/',
    'http://localhost@evil.example/',
    'http://user:pw@localhost:3000/',
    'https://evil.example/?next=http://localhost:3000',
    'javascript:alert(1)//localhost',
    'file:///etc/hosts',
    'ftp://localhost/',
    'ws://localhost:3000/',
    'http://10.0.0.5/',
    'not a url',
  ])('refuses %s', (raw) => {
    expect(() => assertLocalUrl(raw)).toThrow(/local/i);
  });
});

describe('waitForAuthMail (fetch injected, no network)', () => {
  const okJson = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  const mailpitStub = () =>
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname === '/api/v1/messages') return okJson(sample.list);
      const id = /^\/api\/v1\/message\/(.+)$/.exec(url.pathname)?.[1];
      if (id && sample.messages[id]) return okJson(sample.messages[id]);
      return new Response('not found', { status: 404 });
    });

  it('returns the newest full message for the address', async () => {
    const fetchImpl = mailpitStub();
    const m = await waitForAuthMail({
      baseUrl: 'http://127.0.0.1:54324',
      address: 'carlos.candidato@vivienda-e2e.test',
      since: new Date('2026-10-28T14:58:00.000Z'),
      timeoutMs: 1_000,
      intervalMs: 10,
      fetchImpl,
    });
    expect(m.id).toBe('msg-otp-new');
    expect(extractOtp(m)).toBe('482915');
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.every((u) => u.startsWith('http://127.0.0.1:54324/api/v1/'))).toBe(true);
  });

  it('refuses a non-local Mailpit base URL before making any request', async () => {
    const fetchImpl = mailpitStub();
    await expect(
      waitForAuthMail({
        baseUrl: 'https://mail.vivienda-e2e.test',
        address: 'carlos.candidato@vivienda-e2e.test',
        timeoutMs: 1_000,
        intervalMs: 10,
        fetchImpl,
      }),
    ).rejects.toThrow(/local/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out with the address in the error when no fresh mail arrives', async () => {
    await expect(
      waitForAuthMail({
        baseUrl: 'http://localhost:54324',
        address: 'carlos.candidato@vivienda-e2e.test',
        since: new Date('2026-10-28T15:05:00.000Z'),
        timeoutMs: 60,
        intervalMs: 10,
        fetchImpl: mailpitStub(),
      }),
    ).rejects.toThrow(/carlos\.candidato@vivienda-e2e\.test/);
  });

  it('surfaces a non-2xx Mailpit response instead of treating it as an empty inbox', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => new Response('boom', { status: 500 }));
    await expect(
      waitForAuthMail({
        baseUrl: 'http://localhost:54324',
        address: 'carlos.candidato@vivienda-e2e.test',
        timeoutMs: 1_000,
        intervalMs: 10,
        fetchImpl,
      }),
    ).rejects.toThrow(/500/);
  });
});
