import { expect } from '@playwright/test';
import { readStack } from './stack';

/**
 * Email is never really sent: the web app and the C# API both point their SES client at LocalStack,
 * which keeps every message and exposes them at GET /_aws/ses. This reads that mailbox.
 */
export interface Mail {
  subject: string;
  /** Raw body (usually HTML). */
  body: string;
  /** Body with tags stripped and HTML entities decoded — what a reader actually sees. */
  text: string;
  links: string[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

interface LocalStackMessage {
  Destination?: { ToAddresses?: string[] };
  Subject?: string;
  Body?: { html_part?: string | null; text_part?: string | null };
  RawData?: string;
}

/** RFC 2047 encoded words (`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`) in a header value. */
function decodeHeader(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _charset: string, enc: string, text: string) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : decodeQuotedPrintable(text.replace(/_/g, ' ')),
    );
}

function decodeQuotedPrintable(text: string): string {
  const bytes = text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, 'latin1').toString('utf8');
}

function header(block: string, name: string): string {
  // Unfold continuation lines first (RFC 5322 §2.2.3).
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  return new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? '';
}

/** Decoded text of every leaf part of a MIME entity (recursing into multiparts). */
function mimeBodies(entity: string): string[] {
  const split = /\r?\n\r?\n/.exec(entity);
  const head = split ? entity.slice(0, split.index) : entity;
  const body = split ? entity.slice(split.index + split[0].length) : '';
  const type = header(head, 'Content-Type');
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    return body
      .split(`--${boundary}`)
      .slice(1)
      .filter((part) => !part.startsWith('--'))
      .flatMap((part) => mimeBodies(part.replace(/^\r?\n/, '')));
  }
  const encoding = header(head, 'Content-Transfer-Encoding').toLowerCase();
  if (encoding === 'base64') return [Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')];
  if (encoding === 'quoted-printable') return [decodeQuotedPrintable(body)];
  return [body];
}

/**
 * Raw MIME from SendRawEmail (interview invitations with an .ics attachment use it): just enough
 * decoding for a test to read the recipients, the subject and the body — not a MIME library.
 */
function decodeRaw(raw: string): { subject: string; body: string; to: string[] } {
  const head = raw.slice(0, /\r?\n\r?\n/.exec(raw)?.index ?? raw.length);
  const to = decodeHeader(header(head, 'To'))
    .split(',')
    .map((a) => a.replace(/.*</, '').replace(/>.*/, '').trim())
    .filter(Boolean);
  return { subject: decodeHeader(header(head, 'Subject')), body: mimeBodies(raw).join('\n'), to };
}

async function allMessages(): Promise<{ to: string[]; subject: string; body: string }[]> {
  const res = await fetch(`${readStack().localstackURL}/_aws/ses`);
  if (!res.ok) throw new Error(`[e2e] LocalStack SES mailbox returned HTTP ${res.status}`);
  const { messages } = (await res.json()) as { messages: LocalStackMessage[] };
  return messages.map((m) => {
    if (m.RawData) return decodeRaw(m.RawData);
    return {
      to: m.Destination?.ToAddresses ?? [],
      subject: m.Subject ?? '',
      body: m.Body?.html_part ?? m.Body?.text_part ?? '',
    };
  });
}

function extractLinks(body: string): string[] {
  return [...body.matchAll(/https?:\/\/[^"'<>\s)]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));
}

/** Wait (up to `timeout`) for the newest message to `to` whose subject matches, and return it. */
export async function waitForMail(to: string, subject: RegExp, timeout = 30_000): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const hit = (await allMessages())
          .filter((m) => m.to.map((a) => a.toLowerCase()).includes(to.toLowerCase()) && subject.test(m.subject))
          .at(-1);
        if (hit)
          found = { subject: hit.subject, body: hit.body, text: toText(hit.body), links: extractLinks(hit.body) };
        return !!hit;
      },
      { timeout, message: `email to ${to} matching ${subject}` },
    )
    .toBe(true);
  return found!;
}

/** The first link in `mail` whose URL contains `fragment`. */
export function linkContaining(mail: Mail, fragment: string): string {
  const link = mail.links.find((l) => l.includes(fragment));
  if (!link) throw new Error(`[e2e] no link containing "${fragment}" in email "${mail.subject}"`);
  return link;
}
