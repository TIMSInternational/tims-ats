// ── Public job-application consent (Colombia Ley 1581 de 2012 / Decreto 1377 de 2013) ──
// A candidate applying through the public careers portal must give PRIOR, EXPRESS and
// INFORMED authorization before their personal data is processed. The portal renders an
// unchecked checkbox naming the organization and the purpose; `portal.applyToVacancy`
// rejects any submission that does not carry `consentAccepted: true` with the CURRENT
// text version, and records the authorization as a DataConsent row (subject-level status)
// plus one ApplicationConsentEvidence row per application (#313).
//
// Bump APPLICATION_CONSENT_TEXT_VERSION whenever the consent wording (es/en
// `portal.consentCheckbox*` keys) or the linked privacy notice materially changes, so the
// stored row always identifies the text the candidate actually agreed to.
//
// PENDING LEGAL REVIEW: the wording below (and its es/en i18n twins) has not yet been
// reviewed by Colombian counsel — see docs/architecture/csharp-migration/candidate-consent.md.
export const APPLICATION_CONSENT_TYPE = 'recruitment_data_processing';
export const APPLICATION_CONSENT_TEXT_VERSION = 'portal-apply-2026-09-29';

export const APPLICATION_CONSENT_LOCALES = ['es', 'en'] as const;
export type ApplicationConsentLocale = (typeof APPLICATION_CONSENT_LOCALES)[number];

export interface ApplicationConsentTextParts {
  prefix: string;
  middle: string;
  policyLink: string;
  suffix: string;
}

// The EXACT text of APPLICATION_CONSENT_TEXT_VERSION, per locale. The portal renders it from
// the i18n catalogue (`portal.consentCheckbox*`); tests/portal/application-consent-evidence.test.ts and tests/portal/apply-consent-checkbox-drift.test.tsx
// fails if these two copies ever drift, so the server-computed evidence hash always
// identifies the text the candidate was shown.
export const APPLICATION_CONSENT_TEXT: Record<ApplicationConsentLocale, ApplicationConsentTextParts> = {
  es: {
    prefix: 'Autorizo de manera previa, expresa e informada a',
    middle:
      'para tratar mis datos personales, incluida mi hoja de vida, con la finalidad de gestionar mi participación en sus procesos de selección de personal, de acuerdo con su',
    policyLink: 'política de tratamiento de datos personales',
    suffix:
      '. Sé que puedo conocer, actualizar, rectificar o suprimir mis datos y revocar esta autorización en cualquier momento.',
  },
  en: {
    prefix: 'I give my prior, express and informed authorization to',
    middle:
      'to process my personal data, including my resume, for the purpose of managing my participation in its recruitment and selection processes, in accordance with its',
    policyLink: 'personal data processing policy',
    suffix: '. I understand I can access, update, correct or delete my data and revoke this authorization at any time.',
  },
};

/**
 * The consent sentence exactly as the apply form's checkbox label reads it (its textContent):
 * `{prefix} {organization} {middle} {policyLink}{suffix}`. The organization is the data
 * controller — the tenant that owns the vacancy.
 */
export function renderApplicationConsentText(locale: ApplicationConsentLocale, controllerName: string): string {
  const p = APPLICATION_CONSENT_TEXT[locale];
  return `${p.prefix} ${controllerName} ${p.middle} ${p.policyLink}${p.suffix}`;
}

// How an organization received a withdrawal it records on the candidate's behalf (#312).
// `portal` is reserved for the candidate's own self-service withdrawal.
export const CONSENT_WITHDRAWAL_CHANNELS = ['email', 'phone', 'in_person', 'letter', 'other'] as const;
export type ConsentWithdrawalChannel = (typeof CONSENT_WITHDRAWAL_CHANNELS)[number];
export const CONSENT_WITHDRAWAL_REASON_MAX = 500;
