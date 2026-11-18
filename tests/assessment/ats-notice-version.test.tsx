import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATS_NOTICE_VERSION, atsNoticeAcknowledgment } from '../../apps/web/components/assessment-consent-notice';

// Round 12: the portal records the candidate's acknowledgment of the ATS notice with its version. The web copy and the
// C# launch (which accepts only the current version and records it) must name the SAME version, or every launch of a
// sitting not started is refused (422 notice_required).
describe('ATS notice version', () => {
  it('is the version the C# launch accepts', () => {
    const source = readFileSync(
      resolve(__dirname, '../../services/Tims.Platform/src/Tims.Domain/Assessments/Providers/AtsNotice.cs'),
      'utf8',
    );
    const match = /public const string CurrentVersion = "([^"]+)";/.exec(source);
    expect(match?.[1]).toBe(ATS_NOTICE_VERSION);
    expect(ATS_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-ats-notice-v\d+$/);
  });

  it('is acknowledged in the language the notice was shown in', () => {
    expect(atsNoticeAcknowledgment('EN')).toEqual({ textVersion: ATS_NOTICE_VERSION, locale: 'en' });
    expect(atsNoticeAcknowledgment('ES')).toEqual({ textVersion: ATS_NOTICE_VERSION, locale: 'es' });
  });
});
