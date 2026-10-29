import { describe, it, expect } from 'vitest';
import {
  FALLBACK_TIMEZONE,
  isIanaTimeZone,
  resolveTenantTimeZone,
  zoneLabel,
  zonedWallTimeToUtc,
  todayInZone,
  formatZonedDateTime,
} from '@tims/shared';

// WP-09 PR-1: the tenant-time primitives that PR-4 (emails) and PR-7 (schedule modal,
// interview list, join and signing pages) wire in. Today the emails hard-code
// America/Bogota and the schedule modal builds dates in the browser zone.

const AT = new Date('2026-11-03T16:00:00Z');

describe('resolveTenantTimeZone', () => {
  it('returns the fallback (America/Bogota, decision D-C) when nothing is set', () => {
    expect(FALLBACK_TIMEZONE).toBe('America/Bogota');
    expect(resolveTenantTimeZone({ companyTz: null, orgSettingsTz: null, soleCompanyTz: null })).toEqual({
      timeZone: 'America/Bogota',
      source: 'fallback',
    });
  });

  it('prefers company, then org settings, then the sole company', () => {
    expect(
      resolveTenantTimeZone({
        companyTz: 'America/Mexico_City',
        orgSettingsTz: 'America/Costa_Rica',
        soleCompanyTz: 'America/Panama',
      }),
    ).toEqual({ timeZone: 'America/Mexico_City', source: 'company' });
    expect(
      resolveTenantTimeZone({ companyTz: null, orgSettingsTz: 'America/Costa_Rica', soleCompanyTz: 'America/Panama' }),
    ).toEqual({ timeZone: 'America/Costa_Rica', source: 'orgSettings' });
    expect(
      resolveTenantTimeZone({ companyTz: undefined, orgSettingsTz: undefined, soleCompanyTz: 'America/Panama' }),
    ).toEqual({ timeZone: 'America/Panama', source: 'soleCompany' });
  });

  it('skips an invalid IANA zone and moves down the chain', () => {
    expect(
      resolveTenantTimeZone({ companyTz: 'Mars/Olympus', orgSettingsTz: 'America/Costa_Rica', soleCompanyTz: null }),
    ).toEqual({ timeZone: 'America/Costa_Rica', source: 'orgSettings' });
    expect(resolveTenantTimeZone({ companyTz: '', orgSettingsTz: 'GMT-6 nonsense', soleCompanyTz: null })).toEqual({
      timeZone: 'America/Bogota',
      source: 'fallback',
    });
  });
});

describe('isIanaTimeZone', () => {
  it('accepts real zones and rejects junk', () => {
    expect(isIanaTimeZone('America/Costa_Rica')).toBe(true);
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
  });
});

describe('zoneLabel', () => {
  it('labels Costa Rica in es and en', () => {
    expect(zoneLabel('America/Costa_Rica', 'es', AT)).toBe('hora de Costa Rica (GMT-6)');
    expect(zoneLabel('America/Costa_Rica', 'en', AT)).toBe('Costa Rica time (GMT-6)');
  });

  it('labels Colombia in es', () => {
    expect(zoneLabel('America/Bogota', 'es', AT)).toBe('hora de Colombia (GMT-5)');
  });

  it('falls back to the Intl GMT offset for a zone with no label', () => {
    expect(zoneLabel('Asia/Kolkata', 'es', AT)).toBe('GMT+5:30');
  });
});

describe('zonedWallTimeToUtc', () => {
  it('converts Costa Rica wall time (UTC-6) to UTC', () => {
    expect(zonedWallTimeToUtc('2026-11-03', '10:00', 'America/Costa_Rica').toISOString()).toBe(
      '2026-11-03T16:00:00.000Z',
    );
  });

  it('converts Bogotá wall time (UTC-5) to UTC', () => {
    expect(zonedWallTimeToUtc('2026-11-03', '10:00', 'America/Bogota').toISOString()).toBe('2026-11-03T15:00:00.000Z');
  });

  it('corrects across the Madrid DST boundary (01:30 CEST on 2026-10-25 is 23:30Z the day before)', () => {
    expect(zonedWallTimeToUtc('2026-10-25', '01:30', 'Europe/Madrid').toISOString()).toBe('2026-10-24T23:30:00.000Z');
    expect(zonedWallTimeToUtc('2026-10-25', '04:00', 'Europe/Madrid').toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('converts valid times on either side of a spring-forward gap', () => {
    expect(zonedWallTimeToUtc('2026-03-08', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-03-08', '03:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-03-29', '03:30', 'Europe/Madrid').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it.each([
    ['2026-03-08', '02:30', 'America/New_York'],
    ['2026-03-29', '02:30', 'Europe/Madrid'],
  ])('rejects %s %s in %s, a wall time the spring-forward gap skips', (date, time, tz) => {
    expect(() => zonedWallTimeToUtc(date, time, tz)).toThrow(RangeError);
  });

  it.each([
    ['2026-02-31', '10:00'],
    ['2026-13-01', '10:00'],
    ['2026-00-10', '10:00'],
    ['2026-11-00', '10:00'],
    ['2026-11-03', '24:00'],
    ['2026-11-03', '99:99'],
    ['2026-11-03', '10:60'],
    ['2026-11-03', '10:00:60'],
  ])('rejects the out-of-range calendar or clock value %s %s instead of normalising it', (date, time) => {
    expect(() => zonedWallTimeToUtc(date, time, 'America/Costa_Rica')).toThrow(RangeError);
  });

  it('accepts a real leap day', () => {
    expect(zonedWallTimeToUtc('2028-02-29', '10:00', 'America/Costa_Rica').toISOString()).toBe(
      '2028-02-29T16:00:00.000Z',
    );
  });
});

describe('todayInZone', () => {
  it('returns the tenant-zone date at 23:30 CR, already the next day in UTC', () => {
    expect(todayInZone('America/Costa_Rica', new Date('2026-11-04T05:30:00Z'))).toBe('2026-11-03');
  });
});

describe('formatZonedDateTime', () => {
  it('renders the date and hour in the tenant zone, not the server zone', () => {
    const out = formatZonedDateTime(AT, { timeZone: 'America/Costa_Rica', ui: 'es', tenantLocale: 'es-CR' });
    expect(out).toMatch(/10:00/);
    expect(out).not.toMatch(/16:00/);
  });

  it.each(['es_CR', 'not a locale!', '--'])(
    'falls back to es-CR instead of throwing for the malformed tenant locale %j',
    (tenantLocale) => {
      const out = formatZonedDateTime(AT, { timeZone: 'America/Costa_Rica', ui: 'es', tenantLocale });
      expect(out).toBe(formatZonedDateTime(AT, { timeZone: 'America/Costa_Rica', ui: 'es', tenantLocale: 'es-CR' }));
    },
  );
});
