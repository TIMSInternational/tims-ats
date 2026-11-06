import { describe, expect, it } from 'vitest';
import {
  formatCandidateDate,
  formatCandidateDateTime,
  formatCandidateMoney,
  formatCandidateOfferSalary,
  candidateTimeZone,
  orgSettingsTimeZone,
  safeTimeZone,
  timeZoneLabel,
} from '../../apps/web/lib/candidate-format';

// Intl separates es-CR digit groups with a (narrow) no-break space; compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('candidate money (es-CR)', () => {
  it('shows colones with the ₡ symbol and no decimals', () => {
    expect(plain(formatCandidateMoney(850_000, 'CRC', 'ES'))).toBe('₡850 000');
    expect(plain(formatCandidateMoney(83_333.33, 'crc', 'ES'))).toBe('₡83 333');
  });

  it('keeps the ISO code for every other currency — never a bare "$"', () => {
    expect(plain(formatCandidateMoney(4_500, 'USD', 'ES'))).toBe('USD 4 500');
    expect(plain(formatCandidateMoney(4_500, 'USD', 'EN'))).toBe('USD 4,500');
    expect(formatCandidateMoney(4_500.5, 'USD', 'EN')).not.toContain('$');
  });

  it('shows a legacy non-ISO currency verbatim and digits alone when none is stored', () => {
    expect(plain(formatCandidateMoney(1_500, 'COP$', 'ES'))).toBe('COP$ 1 500');
    expect(plain(formatCandidateMoney(1_500, '', 'ES'))).toBe('1 500');
  });

  it('leads an offer with the monthly amount, then the stored annual base', () => {
    expect(plain(formatCandidateOfferSalary(10_200_000, 'CRC', { perMonth: 'mes', perYear: 'año' }, 'ES'))).toBe(
      '₡850 000 / mes (₡10 200 000 / año)',
    );
  });
});

describe('candidate dates and time zones', () => {
  const at = new Date('2026-11-04T16:00:00Z'); // 10:00 in Costa Rica (GMT-6)

  it('formats an interview in the organization zone with "hora de Costa Rica (GMT-6)" and no seconds', () => {
    const text = plain(formatCandidateDateTime(at, 'ES', 'America/Costa_Rica'));
    expect(text).toContain('4 de noviembre de 2026');
    expect(text).toContain('10:00');
    expect(text).not.toMatch(/10:00:00/);
    expect(text.endsWith('hora de Costa Rica (GMT-6)')).toBe(true);
  });

  it('names another zone with the shared label and falls back to an explicit UTC — never the device clock or Bogotá', () => {
    // The shared label (the one interview emails print), not a Costa-Rica-only special case.
    expect(timeZoneLabel(at, 'America/Guatemala', 'ES')).toBe('hora de Guatemala (GMT-6)');
    expect(timeZoneLabel(at, 'America/Guatemala', 'EN')).toBe('Guatemala time (GMT-6)');
    expect(timeZoneLabel(at, 'America/Mexico_City', 'ES')).toBe('hora de Ciudad de México (GMT-6)');
    expect(timeZoneLabel(at, null, 'ES')).toBe('UTC');
    expect(plain(formatCandidateDateTime(at, 'ES', 'America/Guatemala')).endsWith('hora de Guatemala (GMT-6)')).toBe(true);
    const utc = plain(formatCandidateDateTime(at, 'ES', null));
    expect(utc).toMatch(/4:00 p\. m\./);
    expect(utc.endsWith('UTC')).toBe(true);
  });

  it('formats a date in the organization zone (a late-evening UTC instant is still the local day)', () => {
    const lateUtc = '2026-11-05T03:00:00Z'; // 4 Nov, 21:00 in Costa Rica
    expect(formatCandidateDate(lateUtc, 'ES', 'America/Costa_Rica')).toBe('4 de noviembre de 2026');
    expect(formatCandidateDate(lateUtc, 'ES', null)).toBe('5 de noviembre de 2026');
    expect(formatCandidateDate('not a date', 'ES', null)).toBe('');
  });

  it('accepts only a usable IANA zone from organizations.settings', () => {
    expect(orgSettingsTimeZone({ timezone: 'America/Costa_Rica' })).toBe('America/Costa_Rica');
    expect(orgSettingsTimeZone({ timezone: 'Mars/Olympus' })).toBeNull();
    expect(orgSettingsTimeZone({})).toBeNull();
    expect(orgSettingsTimeZone(null)).toBeNull();
    expect(orgSettingsTimeZone(['America/Costa_Rica'])).toBeNull();
    expect(safeTimeZone('x'.repeat(65))).toBeNull();
  });

  it('resolves the portal zone organization → primary company, like the emails (not settings only)', () => {
    expect(candidateTimeZone({ timezone: 'America/Guatemala' }, 'America/Bogota')).toBe('America/Guatemala');
    // No zone on the organization: the company's, as the interview and offer emails already show it.
    expect(candidateTimeZone({}, 'America/Guatemala')).toBe('America/Guatemala');
    expect(candidateTimeZone({ timezone: 'Mars/Olympus' }, 'America/Costa_Rica')).toBe('America/Costa_Rica');
    expect(candidateTimeZone(null, null)).toBeNull();
    expect(candidateTimeZone({}, 'Mars/Olympus')).toBeNull();
  });
});
