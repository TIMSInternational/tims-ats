// ---------------------------------------------------------------------------
// Minimal MIME (RFC 5322 / 2045 / 2046 / 2047) builder for SES SendRawEmail
// ---------------------------------------------------------------------------
// Only used for mail that needs an attachment (interview .ics). Structure:
//   multipart/mixed
//     ├─ multipart/alternative ( text/plain , text/html )
//     └─ text/calendar; method=… (attachment, base64)
// SECURITY: header values are rejected if they contain CR/LF (header injection);
// all bodies are base64 so no body line can collide with a boundary, and the
// boundary contains '_' which is outside the base64 alphabet.

import { randomBytes } from 'node:crypto';

export type MimeCalendarAttachment = {
  method: 'REQUEST' | 'CANCEL';
  filename: string;
  content: string;
};

export type MimeMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  calendar?: MimeCalendarAttachment;
  /** Domain used for the Message-ID. */
  messageIdDomain: string;
  date?: Date;
};

const CRLF = '\r\n';
const EMAIL_RE =
  /^[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+@[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+\.[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+$/;

export class MimeHeaderError extends Error {
  constructor(field: string) {
    super(`Unsafe value for MIME header ${field}`);
    this.name = 'MimeHeaderError';
  }
}

function assertHeaderSafe(field: string, value: string): string {
  if (/[\r\n\x00]/.test(value)) throw new MimeHeaderError(field);
  return value;
}

/** A bare mailbox address (no display name) — the only form we emit. */
export function assertMailbox(field: string, address: string): string {
  assertHeaderSafe(field, address);
  if (!EMAIL_RE.test(address) || address.length > 320) throw new MimeHeaderError(field);
  return address;
}

/**
 * RFC 2047 "B" encoding for a header value. Pure printable ASCII short enough to
 * stay on one line is emitted as-is; anything else becomes UTF-8 encoded-words of
 * ≤75 chars each (never splitting a code point), folded with CRLF SP.
 */
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value) && value.length <= 70) return value;
  const words: string[] = [];
  let chunk = '';
  // 45 raw bytes → 60 base64 chars; + "=?UTF-8?B?" (10) + "?=" (2) = 72 ≤ 75.
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk || words.length === 0) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

function base64Body(content: string): string {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join(CRLF);
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 100) : 'invite.ics';
}

function newBoundary(tag: string): string {
  return `----=_TIMS_${tag}_${randomBytes(12).toString('hex')}`;
}

function part(headers: string[], body: string): string {
  return headers.join(CRLF) + CRLF + CRLF + body + CRLF;
}

export function buildMimeMessage(msg: MimeMessage): string {
  const from = assertHeaderSafe('From', msg.from);
  const to = assertMailbox('To', msg.to);
  const subject = encodeHeaderWord(assertHeaderSafe('Subject', msg.subject));
  const domain = assertHeaderSafe('Message-ID', msg.messageIdDomain).replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';

  const mixed = newBoundary('mixed');
  const alt = newBoundary('alt');

  const alternative =
    `--${alt}${CRLF}` +
    part(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'], base64Body(msg.text)) +
    `--${alt}${CRLF}` +
    part(['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'], base64Body(msg.html)) +
    `--${alt}--`;

  let body = `--${mixed}${CRLF}` + part([`Content-Type: multipart/alternative; boundary="${alt}"`], alternative);
  if (msg.calendar) {
    const file = safeFilename(msg.calendar.filename);
    body +=
      `--${mixed}${CRLF}` +
      part(
        [
          `Content-Type: text/calendar; charset=UTF-8; method=${msg.calendar.method}; name="${file}"`,
          `Content-Disposition: attachment; filename="${file}"`,
          'Content-Transfer-Encoding: base64',
        ],
        base64Body(msg.calendar.content),
      );
  }
  body += `--${mixed}--${CRLF}`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${(msg.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  return headers.join(CRLF) + CRLF + CRLF + body;
}
