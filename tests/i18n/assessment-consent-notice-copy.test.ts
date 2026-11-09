import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// The ATS notice for TIMS Assessments (design §6.3, consent and transparency). It is candidate-facing copy: it names
// TIMS Assessments and the organization, the purpose "selection for vacancy X", who sees the results, retention and the
// candidate's rights; it says it is a draft pending counsel (owner default D22); it cites no specific law until
// counsel-approved per-country text exists (as the privacy notice); and the Spanish addresses the candidate as usted.

const TU_OR_APLICAR =
  /\b(tu|tus|te|ti|contigo|tienes|puedes|debes|quieres|deseas|estás|eres|ingresa|escribe|recarga|intenta|revisa|contacta|aplicación|aplicaciones|aplicar|aplica)\b/i;
const COUNTRY_LAW = /Ley\s|\bLaw\b|8968|1581|Colombia|Costa Rica|Guatemala|Superintenden|PRODHAB/;

describe('assessment consent notice copy', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)(
    '%s: names TIMS Assessments, the purpose, recipients, retention and rights, and is marked a draft',
    (_l, dict) => {
      const n = dict.assessmentConsentNotice;
      expect(n.intro).toContain('TIMS Assessments');
      expect(n.intro).toContain('{org}');
      expect(n.purpose).toContain('{vacancy}');
      expect(n.recipients).toContain('{org}');
      expect(n.retention).toMatch(/24/);
      expect(n.rights).toMatch(/{org}/);
      expect(n.draftBanner).toContain('D22');
      for (const [key, text] of Object.entries(n)) expect(`${key}: ${text}`).not.toMatch(COUNTRY_LAW);
    },
  );

  it('addresses the candidate as usted in Spanish', () => {
    const offenders = Object.entries(es.assessmentConsentNotice).filter(([, text]) => TU_OR_APLICAR.test(text));
    expect(offenders).toEqual([]);
  });

  it('tells the candidate that no test rejects them automatically and that a person decides', () => {
    expect(es.assessmentConsentNotice.recipients).toContain('una persona decide');
    expect(en.assessmentConsentNotice.recipients).toContain('a person decides');
  });
});
