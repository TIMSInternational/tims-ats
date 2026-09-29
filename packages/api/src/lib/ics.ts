// ---------------------------------------------------------------------------
// Minimal RFC 5545 iCalendar (iTIP REQUEST / CANCEL) builder for interview invites
// ---------------------------------------------------------------------------
// Pure and dependency-free. Every dynamic value is either TEXT-escaped (§3.3.11),
// parameter-quoted (§3.2) or validated (mailto/URI), and every content line is
// CRLF-terminated and folded at 75 octets (§3.1) without splitting a UTF-8 sequence.

export type IcsMethod = 'REQUEST' | 'CANCEL';

export type IcsParty = { name: string; email: string };

export type IcsEvent = {
  method: IcsMethod;
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
  organizer: IcsParty;
  attendees: IcsParty[];
};

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const SEQUENCE_EPOCH_MS = Date.UTC(2026, 0, 1);
// Conservative mailbox check: no whitespace, quotes, angle brackets, control chars.
const EMAIL_RE =
  /^[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+@[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+\.[^\s"<>(),;:\\[\]\x00-\x1f\x7f]+$/;

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** §3.2 param-value: quoted-string may not contain DQUOTE or control characters. */
function quoteParam(value: string): string {
  return `"${value.replace(/["\x00-\x1f\x7f]/g, '').trim()}"`;
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

/** §3.1 folding: split at ≤75 octets, never inside a UTF-8 multi-byte sequence. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const ch of line) {
    const octets = Buffer.byteLength(ch, 'utf8');
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
  const cancel = event.method === 'CANCEL';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TIMS International//TIMS ATS//ES',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
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
  lines.push(`ORGANIZER;CN=${quoteParam(event.organizer.name)}:${mailto(event.organizer.email)}`);
  // RSVP=FALSE: the organizer is the no-reply sending mailbox, so replies would bounce.
  for (const attendee of event.attendees) {
    lines.push(
      `ATTENDEE;CN=${quoteParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:${mailto(attendee.email)}`,
    );
  }
  lines.push(`STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
