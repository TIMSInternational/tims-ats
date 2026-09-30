import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  sequenceFromUpdatedAt,
  type IcsEvent,
} from '../../packages/api/src/lib/ics';

const base: IcsEvent = {
  method: 'REQUEST',
  uid: 'interview-11111111-1111-1111-1111-111111111111@tims.example',
  sequence: 7,
  start: new Date('2026-10-01T15:00:00.000Z'),
  end: new Date('2026-10-01T16:00:00.000Z'),
  stamp: new Date('2026-09-29T12:34:56.789Z'),
  summary: 'Videoconferencia: Analista, Senior; Bogotá',
  description: 'Línea 1\nLínea 2 \\ fin',
  location: 'https://app.example/interview/join/abc',
  url: 'https://app.example/interview/join/abc',
  organizer: { name: 'ACME "Talent"', email: 'noreply@tims.example' },
  attendees: [{ name: 'Ana Gómez', email: 'ana@example.com' }],
};

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('ics builder', () => {
  it('escapes backslash, semicolon, comma and newlines (RFC 5545 §3.3.11)', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    const lines = unfold(buildIcs(base));
    expect(lines).toContain('SUMMARY:Videoconferencia: Analista\\, Senior\\; Bogotá');
    expect(lines).toContain('DESCRIPTION:Línea 1\\nLínea 2 \\\\ fin');
  });

  it('uses CRLF line endings only', () => {
    const ics = buildIcs(base);
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('folds at 75 octets without splitting a UTF-8 sequence', () => {
    const long = `DESCRIPTION:${'ñ'.repeat(120)}`;
    const folded = foldIcsLine(long);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const line of physical) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    for (const line of physical.slice(1)) expect(line.startsWith(' ')).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(folded).not.toContain('�');
    const ics = buildIcs({ ...base, description: 'x'.repeat(400) });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('emits METHOD:REQUEST + CONFIRMED for invites', () => {
    const lines = unfold(buildIcs(base));
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('STATUS:CONFIRMED');
  });

  it('emits METHOD:CANCEL + STATUS:CANCELLED for cancellations with the same UID', () => {
    const invite = unfold(buildIcs(base));
    const cancel = unfold(buildIcs({ ...base, method: 'CANCEL', sequence: 8 }));
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('STATUS:CANCELLED');
    expect(cancel).not.toContain('METHOD:REQUEST');
    const uid = (l: string[]) => l.find((x) => x.startsWith('UID:'));
    expect(uid(cancel)).toBe(uid(invite));
  });

  it('writes UTC Z times, SEQUENCE, ORGANIZER and ATTENDEE', () => {
    const lines = unfold(buildIcs(base));
    expect(lines).toContain('DTSTART:20261001T150000Z');
    expect(lines).toContain('DTEND:20261001T160000Z');
    expect(lines).toContain('DTSTAMP:20260929T123456Z');
    expect(lines).toContain('SEQUENCE:7');
    expect(lines).toContain('ORGANIZER;CN="ACME Talent":mailto:noreply@tims.example');
    expect(lines.find((l) => l.startsWith('ATTENDEE'))).toMatch(/CN="Ana Gómez".*:mailto:ana@example\.com$/);
    expect(formatIcsUtc(new Date('2026-01-02T03:04:05Z'))).toBe('20260102T030405Z');
  });

  it('derives a strictly increasing SEQUENCE from updatedAt', () => {
    const a = sequenceFromUpdatedAt(new Date('2026-09-29T10:00:00Z'));
    const b = sequenceFromUpdatedAt(new Date('2026-09-29T10:00:05Z'));
    expect(b).toBeGreaterThan(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeLessThan(2 ** 31);
  });

  it('rejects injection via attendee address or UID', () => {
    expect(() =>
      buildIcs({ ...base, attendees: [{ name: 'x', email: 'a@b.com\r\nATTENDEE:mailto:evil@x.com' }] }),
    ).toThrow();
    expect(() => buildIcs({ ...base, uid: 'bad\r\nUID:x' })).toThrow();
    const lines = unfold(buildIcs({ ...base, attendees: [{ name: 'Eve\r\nX-EVIL:1', email: 'eve@example.com' }] }));
    expect(lines.some((l) => l.startsWith('X-EVIL'))).toBe(false);
  });
});
