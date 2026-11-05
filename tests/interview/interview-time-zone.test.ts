import { describe, expect, it } from 'vitest';
import {
  orgSettingsTimeZone,
  resolveInterviewTimeZone,
  timeZoneLabel,
  zonedDateString,
  zonedWallTimeToDate,
} from '../../packages/shared/src/time-zone';

// Pilot (C-36 / A-17): interview times carry an explicit zone label from the organization's zone,
// with the company zone then UTC as fallbacks — never America/Bogota.

describe('resolveInterviewTimeZone', () => {
  it('prefers the organization zone, then the company zone, then UTC', () => {
    expect(resolveInterviewTimeZone('America/Costa_Rica', 'America/Bogota')).toBe('America/Costa_Rica');
    expect(resolveInterviewTimeZone(null, 'America/Panama')).toBe('America/Panama');
    expect(resolveInterviewTimeZone(null, null)).toBe('UTC');
    expect(resolveInterviewTimeZone('Mars/Olympus', 'Nope/Zone')).toBe('UTC');
  });

  it('orgSettingsTimeZone accepts only a valid, bounded IANA zone', () => {
    expect(orgSettingsTimeZone({ timezone: 'America/Costa_Rica' })).toBe('America/Costa_Rica');
    for (const settings of [{ timezone: '' }, { timezone: 'x'.repeat(65) }, { timezone: 42 }, null, [], 'x']) {
      expect(orgSettingsTimeZone(settings)).toBeNull();
    }
  });
});

describe('timeZoneLabel', () => {
  const at = new Date('2026-11-10T16:00:00Z');
  it('names Costa Rica with its offset in both locales', () => {
    expect(timeZoneLabel('America/Costa_Rica', 'es', at)).toBe('hora de Costa Rica (GMT-6)');
    expect(timeZoneLabel('America/Costa_Rica', 'en', at)).toBe('Costa Rica time (GMT-6)');
  });

  it('labels UTC (and unusable zones) as plain UTC', () => {
    expect(timeZoneLabel('UTC', 'es', at)).toBe('UTC');
    expect(timeZoneLabel('Etc/UTC', 'en', at)).toBe('UTC');
    expect(timeZoneLabel('Mars/Olympus', 'es', at)).toBe('UTC');
  });

  it('falls back to the city of an unmapped zone and follows DST', () => {
    expect(timeZoneLabel('Europe/Madrid', 'es', new Date('2026-07-01T12:00:00Z'))).toBe('hora de Madrid (GMT+2)');
    expect(timeZoneLabel('Europe/Madrid', 'es', new Date('2026-12-01T12:00:00Z'))).toBe('hora de Madrid (GMT+1)');
  });
});

describe('zonedWallTimeToDate', () => {
  it('reads the wall clock in the given zone, not the runtime zone', () => {
    expect(zonedWallTimeToDate('2026-11-10', '10:00', 'America/Costa_Rica')?.toISOString()).toBe(
      '2026-11-10T16:00:00.000Z',
    );
    expect(zonedWallTimeToDate('2026-11-10', '10:00', 'UTC')?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });

  it('handles both sides of a DST change', () => {
    expect(zonedWallTimeToDate('2026-03-08', '01:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(zonedWallTimeToDate('2026-03-08', '03:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('rejects a wall time that does not exist (the hour skipped by DST) instead of moving it', () => {
    expect(zonedWallTimeToDate('2027-03-14', '02:30', 'America/New_York')).toBeNull();
    expect(zonedWallTimeToDate('2027-03-14', '03:30', 'America/New_York')?.toISOString()).toBe(
      '2027-03-14T07:30:00.000Z',
    );
  });

  it('rejects malformed input and treats an unusable zone as UTC', () => {
    expect(zonedWallTimeToDate('2026-13-01', '10:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToDate('10/11/2026', '10:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToDate('2026-11-10', '9:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToDate('2026-11-10', '10:00', 'Mars/Olympus')?.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });
});

describe('zonedDateString', () => {
  it('computes "tomorrow" on the zone calendar (19:00 in Costa Rica is already the next UTC day)', () => {
    const evening = new Date('2026-11-11T01:00:00Z'); // 2026-11-10 19:00 in Costa Rica
    expect(zonedDateString('America/Costa_Rica', 0, evening)).toBe('2026-11-10');
    expect(zonedDateString('America/Costa_Rica', 1, evening)).toBe('2026-11-11');
    expect(zonedDateString('UTC', 1, evening)).toBe('2026-11-12');
  });

  it('rolls over month and year ends', () => {
    expect(zonedDateString('America/Costa_Rica', 1, new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
});
