import { afterEach, describe, expect, it } from 'vitest';
import * as sharedIcs from '../../packages/shared/src/calendar/ics';
import { googleCalendarUrl, interviewIcsUid } from '../../packages/shared/src/calendar/calendar-links';
import * as apiIcs from '../../packages/api/src/lib/ics';

// WP-19 PR-3 (candidate-ideal-85 groundwork): the interview .ics builder moves to packages/shared so the
// candidate portal can offer "add to calendar" (.ics PUBLISH download + Google Calendar link) next to the
// emailed REQUEST/CANCEL invite. The email path and the portal path must produce the SAME UID so calendar
// apps de-duplicate the two copies of one interview.

const { buildIcs, escapeIcsText } = sharedIcs;

const INTERVIEW_ID = '11111111-1111-1111-1111-111111111111';
const HOST = 'tims.example';

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

function publishEvent(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PUBLISH' as const,
    uid: interviewIcsUid(INTERVIEW_ID, HOST),
    sequence: 3,
    start: new Date('2026-11-06T16:00:00.000Z'),
    end: new Date('2026-11-06T17:00:00.000Z'),
    stamp: new Date('2026-11-01T12:00:00.000Z'),
    summary: 'Entrevista: Analista, Senior; Costa Rica',
    description: 'Línea 1\nLínea 2',
    location: 'Oficina central, piso 3; sala B',
    ...overrides,
  };
}

describe('shared ICS: PUBLISH events for the candidate portal', () => {
  it('builds a PUBLISH event without organizer or attendees, with METHOD:PUBLISH and no ORGANIZER/ATTENDEE lines', () => {
    const lines = unfold(buildIcs(publishEvent()));
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines.some((l) => l.startsWith('ORGANIZER'))).toBe(false);
    expect(lines.some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('DTSTART:20261106T160000Z');
    expect(lines).toContain('DTEND:20261106T170000Z');
  });

  it('escapes , ; and newlines in a PUBLISH event (RFC 5545 §3.3.11)', () => {
    expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd');
    const lines = unfold(buildIcs(publishEvent()));
    expect(lines).toContain('SUMMARY:Entrevista: Analista\\, Senior\\; Costa Rica');
    expect(lines).toContain('DESCRIPTION:Línea 1\\nLínea 2');
    expect(lines).toContain('LOCATION:Oficina central\\, piso 3\\; sala B');
  });

  it('folds long lines without relying on the Node Buffer global (shared code runs in the browser)', () => {
    const g = globalThis as { Buffer?: unknown };
    const saved = g.Buffer;
    try {
      g.Buffer = undefined;
      const ics = buildIcs(publishEvent({ description: 'á'.repeat(200) }));
      for (const line of ics.split('\r\n')) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
    } finally {
      g.Buffer = saved;
    }
  });
});

describe('interviewIcsUid', () => {
  it('equals interview-<id>@<host>, the UID the interview email uses', () => {
    expect(interviewIcsUid(INTERVIEW_ID, HOST)).toBe(`interview-${INTERVIEW_ID}@${HOST}`);
  });

  it('is accepted by buildIcs and lands on the UID line verbatim', () => {
    const lines = unfold(buildIcs(publishEvent()));
    expect(lines).toContain(`UID:interview-${INTERVIEW_ID}@${HOST}`);
  });
});

describe('googleCalendarUrl', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  // 10:00 in Costa Rica (UTC-6, no DST) for 60 minutes.
  const start = new Date('2026-11-06T10:00:00-06:00');
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  it('uses UTC dates (20261106T160000Z/20261106T170000Z) for a 10:00 Costa Rica start of 60 minutes', () => {
    process.env.TZ = 'America/Costa_Rica';
    const url = new URL(
      googleCalendarUrl({ title: 'Entrevista', start, end, details: 'Detalles', location: 'Sala B' }),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261106T160000Z/20261106T170000Z');
  });

  it('round-trips title, details and location (with , ; & and newlines) through URL encoding', () => {
    const title = 'Entrevista: Analista, Senior; R&D';
    const details = 'Línea 1\nLínea 2 & más';
    const location = 'Oficina #3, piso 2';
    const url = new URL(googleCalendarUrl({ title, start, end, details, location }));
    expect(url.searchParams.get('text')).toBe(title);
    expect(url.searchParams.get('details')).toBe(details);
    expect(url.searchParams.get('location')).toBe(location);
  });
});

describe('packages/api/src/lib/ics is a re-export of the shared module, not a copy', () => {
  it('exposes the identical function objects', () => {
    expect(apiIcs.buildIcs).toBe(sharedIcs.buildIcs);
    expect(apiIcs.escapeIcsText).toBe(sharedIcs.escapeIcsText);
    expect(apiIcs.foldIcsLine).toBe(sharedIcs.foldIcsLine);
    expect(apiIcs.formatIcsUtc).toBe(sharedIcs.formatIcsUtc);
    expect(apiIcs.sequenceFromUpdatedAt).toBe(sharedIcs.sequenceFromUpdatedAt);
  });
});
