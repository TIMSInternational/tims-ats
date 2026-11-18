import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// The ATS's own short notice for TIMS Assessments (design §6.3, consent and transparency), final copy (round 12). It is
// candidate-facing and states only what the ATS code does: who receives the data (TIMS Assessments, as processor for the
// hiring organization), the purpose (selection for the vacancy), that a person decides, and how to withdraw in the
// portal. The provider's own consent texts carry the approved per-purpose wording. It cites no specific law, makes no
// retention or rights claim the ATS does not enforce, carries no draft marker, and the Spanish addresses the candidate
// as usted.

const TU_OR_APLICAR =
  /\b(tu|tus|te|ti|contigo|tienes|puedes|debes|quieres|deseas|estás|eres|ingresa|escribe|recarga|intenta|revisa|contacta|aplicación|aplicaciones|aplicar|aplica)\b/i;
const COUNTRY_LAW = /Ley\s|\bLaw\b|8968|1581|Colombia|Costa Rica|Guatemala|Superintenden|PRODHAB/;
const DRAFT = /BORRADOR|DRAFT|PENDIENTE DE REVISIÓN|PENDING (LEGAL|COUNSEL)|counsel|asesoría legal|D22/i;
const UNENFORCED = /24 meses|24 months|anonimi|rectifica|correct|retention|conserva/i;

describe('assessment consent notice copy', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: names the processor, the purpose, who decides and how to withdraw', (_l, dict) => {
    const n = dict.assessmentConsentNotice;
    expect(n.intro).toContain('TIMS Assessments');
    expect(n.intro).toContain('{org}');
    expect(n.intro).toMatch(/encargado|processor/);
    expect(n.purpose).toContain('{vacancy}');
    expect(n.decision).toMatch(/una persona|a person/);
    expect(n.withdraw).toMatch(/portal/);
    expect(n.versionLabel).toContain('{version}');
    expect(Object.keys(n).sort()).toEqual(
      [
        'decision',
        'decisionTitle',
        'intro',
        'providerConsents',
        'purpose',
        'purposeTitle',
        'readAck',
        'testsTitle',
        'title',
        'versionLabel',
        'withdraw',
        'withdrawTitle',
      ].sort(),
    );
    for (const [key, text] of Object.entries(n)) {
      expect(`${key}: ${text}`).not.toMatch(COUNTRY_LAW);
      expect(`${key}: ${text}`).not.toMatch(DRAFT);
      expect(`${key}: ${text}`).not.toMatch(UNENFORCED);
    }
  });

  it('addresses the candidate as usted in Spanish', () => {
    const offenders = Object.entries(es.assessmentConsentNotice).filter(([, text]) => TU_OR_APLICAR.test(text));
    expect(offenders).toEqual([]);
  });

  it('leaves no PENDING COUNSEL marker on any assessment consent screen', () => {
    for (const dict of [es, en]) {
      const portal = Object.entries(dict.portalDashboard).filter(([key]) => key.startsWith('provider'));
      for (const [key, text] of portal) expect(`${key}: ${text}`).not.toMatch(DRAFT);
      for (const [key, text] of Object.entries(dict.assignProviderAssessments)) {
        if (typeof text === 'string') expect(`${key}: ${text}`).not.toMatch(DRAFT);
      }
    }
  });
});
