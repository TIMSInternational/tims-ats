import { describe, expect, it } from 'vitest';
import { buildMimeMessage, encodeHeaderWord, MimeHeaderError } from '../../packages/api/src/lib/mime';
import { parseMime, splitHeaders } from '../helpers/mime-parse';

const ICS = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nSUMMARY:Entrevista — Bogotá\r\nEND:VCALENDAR\r\n';
const msg = {
  from: 'TIMS <noreply@tims.example>',
  to: 'ana@example.com',
  subject: 'Invitación a entrevista — Analista',
  html: '<p>Hola <strong>Ana</strong></p>',
  text: 'Hola Ana',
  calendar: { method: 'REQUEST' as const, filename: 'invite.ics', content: ICS },
  messageIdDomain: 'tims.example',
};

describe('MIME builder', () => {
  it('builds multipart/mixed with alternative(text, html) + base64 text/calendar attachment', () => {
    const raw = buildMimeMessage(msg);
    const { headers } = splitHeaders(raw);
    expect(headers).toMatch(/^Content-Type: multipart\/mixed; boundary="----=_TIMS_mixed_[0-9a-f]+"$/m);
    expect(headers).toMatch(/^MIME-Version: 1\.0$/m);
    expect(headers).toMatch(/^To: ana@example\.com$/m);

    const parts = parseMime(raw);
    expect(parts.map((p) => p.contentType.split(';')[0])).toEqual(['text/plain', 'text/html', 'text/calendar']);
    expect(parts[0].body).toBe('Hola Ana');
    expect(parts[1].body).toBe(msg.html);
    const cal = parts[2];
    expect(cal.contentType).toContain('method=REQUEST');
    expect(cal.headers).toMatch(/Content-Disposition: attachment; filename="invite\.ics"/);
    expect(cal.headers).toMatch(/Content-Transfer-Encoding: base64/);
    expect(cal.body).toBe(ICS);
  });

  it('tags a cancellation attachment with method=CANCEL', () => {
    const raw = buildMimeMessage({ ...msg, calendar: { ...msg.calendar, method: 'CANCEL', filename: 'cancel.ics' } });
    expect(parseMime(raw)[2].contentType).toContain('method=CANCEL');
  });

  it('uses CRLF everywhere and closes every boundary', () => {
    const raw = buildMimeMessage(msg);
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const mixed = /boundary="([^"]+)"/.exec(raw)?.[1];
    expect(raw).toContain(`--${mixed}--`);
  });

  it('RFC 2047-encodes a non-ASCII subject', () => {
    const raw = buildMimeMessage(msg);
    const subjectLine = /^Subject: ([\s\S]*?)\r\n(?! )/m.exec(raw)?.[1] ?? '';
    expect(subjectLine).toMatch(/^=\?UTF-8\?B\?/);
    const decoded = subjectLine
      .split(/\r\n /)
      .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe(msg.subject);
    expect(encodeHeaderWord('Plain subject')).toBe('Plain subject');
  });

  it('rejects CR/LF header injection in subject and recipient', () => {
    expect(() => buildMimeMessage({ ...msg, subject: 'Hi\r\nBcc: evil@x.com' })).toThrow(MimeHeaderError);
    expect(() => buildMimeMessage({ ...msg, to: 'ana@example.com\r\nBcc: evil@x.com' })).toThrow(MimeHeaderError);
    expect(() => buildMimeMessage({ ...msg, to: 'ana@example.com, evil@x.com' })).toThrow(MimeHeaderError);
    expect(() => buildMimeMessage({ ...msg, from: 'x\nBcc: evil@x.com' })).toThrow(MimeHeaderError);
  });
});
