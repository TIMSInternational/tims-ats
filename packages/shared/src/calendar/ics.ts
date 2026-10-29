// ---------------------------------------------------------------------------
// Minimal RFC 5545 iCalendar builder for interview invites (iTIP REQUEST / CANCEL by email)
// and candidate-portal "add to calendar" downloads (a plain, METHOD-less calendar entry)
// ---------------------------------------------------------------------------
// Pure and dependency-free. Every dynamic value is either TEXT-escaped (§3.3.11),
// parameter-quoted (§3.2) or validated (mailto/URI), and every content line is
// CRLF-terminated and folded at 75 octets (§3.1) without splitting a UTF-8 sequence.
// Browser-safe: it is exported from @tims/shared, which client components import, so it
// must not touch Node globals such as Buffer.

/** iTIP scheduling methods: the emailed invite and its cancellation. */
export type IcsScheduleMethod = 'REQUEST' | 'CANCEL';

export type IcsMethod = IcsScheduleMethod | 'PUBLISH';

export type IcsParty = { name: string; email: string };

type IcsEventBase = {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  /** DTSTAMP — when this iTIP message was produced. */
  stamp: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
};

/**
 * REQUEST / CANCEL are iTIP scheduling messages and always carry an organizer and attendees.
 * PUBLISH (RFC 5546 §3.2.1) requires exactly one organizer and forbids attendees.
 * With no method the result is a plain RFC 5545 calendar entry (no METHOD line), which is not an
 * iTIP object and so carries neither: that is the candidate's own copy, built in the browser,
 * where no organizer mailbox is available.
 */
export type IcsEvent = IcsEventBase &
  (
    | { method: IcsScheduleMethod; organizer: IcsParty; attendees: IcsParty[] }
    | { method: 'PUBLISH'; organizer: IcsParty; attendees?: never }
    | { method?: undefined; organizer?: never; attendees?: never }
  );

const CRLF = '\r\n';
const DQUOTE = '"';
const MAX_LINE_OCTETS = 75;
const SEQUENCE_EPOCH_MS = Date.UTC(2026, 0, 1);
// Conservative mailbox check: no whitespace, quotes, angle brackets, control chars.
const EMAIL_RE =
  /^[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+@[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+\.[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+$/;

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: string): string {
  // One pass over the three TEXT specials, so an escape's own backslash is never re-escaped.
  return value
    .replace(/[\\;,]/g, (ch) => `\\${ch}`)
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** §3.2 param-value: quoted-string may not contain DQUOTE or control characters. */
function quoteParam(value: string): string {
  // A DQUOTE cannot be escaped inside a §3.2 quoted-string, so it is removed, not doubled.
  const inner = value.replace(/["\x00-\x1f\x7f]/g, '').trim();
  return DQUOTE + inner + DQUOTE;
}

function mailto(email: string): string {
  if (!EMAIL_RE.test(email)) throw new Error('Invalid calendar address');
  return `mailto:${email}`;
}

/** UTC basic format: 20260929T150000Z. */
export function formatIcsUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid calendar date');
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Monotonic SEQUENCE derived from the row's updatedAt (seconds since 2026-01-01),
 * so every reschedule/cancel write yields a strictly higher value than the invite
 * it supersedes. Fits a signed 32-bit INTEGER for the next ~68 years.
 */
export function sequenceFromUpdatedAt(updatedAt: Date): number {
  return Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH_MS) / 1000));
}

/** UTF-8 length of one code point, without Node's Buffer (this module also runs in the browser). */
function utf8Octets(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/** §3.1 folding: split at ≤75 octets, never inside a UTF-8 multi-byte sequence. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const ch of line) {
    const octets = utf8Octets(ch);
    if (currentOctets + octets > limit) {
      out.push(current);
      current = '';
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1; // continuation lines start with one SPACE
    }
    current += ch;
    currentOctets += octets;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

function assertUri(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Invalid calendar URL');
  return parsed.toString();
}

export function buildIcs(event: IcsEvent): string {
  if (!/^[A-Za-z0-9._@-]{1,255}$/.test(event.uid)) throw new Error('Invalid calendar UID');
  if (!Number.isInteger(event.sequence) || event.sequence < 0) throw new Error('Invalid calendar SEQUENCE');
  // Runtime guards for callers that bypass the type (casts, plain JS): never emit an invalid object.
  if (event.method === 'PUBLISH' && (!event.organizer || event.attendees !== undefined)) {
    throw new Error('Invalid calendar PUBLISH');
  }
  if (event.method === undefined && (event.organizer !== undefined || event.attendees !== undefined)) {
    throw new Error('Invalid calendar entry');
  }
  const cancel = event.method === 'CANCEL';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TIMS International//TIMS ATS//ES',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    ...(event.method ? [`METHOD:${event.method}`] : []),
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${formatIcsUtc(event.stamp)}`,
    `DTSTART:${formatIcsUtc(event.start)}`,
    `DTEND:${formatIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.url) lines.push(`URL:${assertUri(event.url)}`);
  if (event.organizer) {
    lines.push(`ORGANIZER;CN=${quoteParam(event.organizer.name)}:${mailto(event.organizer.email)}`);
  }
  // RSVP=FALSE: the organizer is the no-reply sending mailbox, so replies would bounce.
  for (const attendee of event.attendees ?? []) {
    lines.push(
      `ATTENDEE;CN=${quoteParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:${mailto(attendee.email)}`,
    );
  }
  lines.push(`STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
