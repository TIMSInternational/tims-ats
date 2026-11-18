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
// reviewed by counsel — see docs/architecture/csharp-migration/candidate-consent.md.
//
// Version history (rows recorded under a superseded version keep it, so stored evidence still
// identifies what the candidate agreed to). A version's text is NEVER edited once candidates may
// have accepted it: a wording change is a new version id.
//   'portal-apply-2026-09-29' — the linked privacy notice (`portalPrivacy.*`) cited Colombia's
//                               Ley 1581 de 2012 and the SIC for every organization.
//   'portal-apply-2026-11-06' — same consent sentence (so the same text hash); the linked notice
//                               is country-neutral ("legislación de protección de datos aplicable").
//                               The DEFAULT variant: what every organization's apply form shows.
//   'portal-apply-2026-11-cr' — the Costa Rica (Ley N.° 8968) variant: its own consent sentence and
//                               the linked `portalPrivacyLey8968.*` notice. Off unless both
//                               LEY_8968_NOTICE_TEXT_FINAL and NEXT_PUBLIC_LEY_8968_NOTICE_ENABLED
//                               are on (see resolveApplicationConsentVariant).
export const APPLICATION_CONSENT_TYPE = 'recruitment_data_processing';

export const APPLICATION_CONSENT_VARIANTS = ['default', 'ley8968'] as const;
export type ApplicationConsentVariant = (typeof APPLICATION_CONSENT_VARIANTS)[number];

export const APPLICATION_CONSENT_VERSIONS: Record<ApplicationConsentVariant, string> = {
  default: 'portal-apply-2026-11-06',
  ley8968: 'portal-apply-2026-11-cr',
};

/**
 * The Ley N.° 8968 consent sentence and candidate notice are a DRAFT awaiting review by the data
 * controller's counsel (the notice still carries [PENDIENTE: …] markers for undecided values). This
 * stays `false` until the approved text replaces the draft; tests/portal/privacy-notice-ley-8968.test.tsx
 * fails if it is `true` while a marker remains, and the env flag alone can never publish a draft.
 * Until it is first published, the draft may still change under 'portal-apply-2026-11-cr' (no
 * candidate can have accepted it); after that, any wording change needs a new version id.
 */
export const LEY_8968_NOTICE_TEXT_FINAL: boolean = false;

/**
 * Which consent sentence + candidate notice the platform shows. `flag` is
 * NEXT_PUBLIC_LEY_8968_NOTICE_ENABLED (exact 'true' only); the Ley 8968 variant also needs the
 * approved text (`textFinal`). Platform-wide: the apply endpoint accepts ONE version at a time.
 */
export function resolveApplicationConsentVariant(
  flag: string | undefined,
  textFinal: boolean = LEY_8968_NOTICE_TEXT_FINAL,
): ApplicationConsentVariant {
  return textFinal && flag === 'true' ? 'ley8968' : 'default';
}

// A literal `process.env.NEXT_PUBLIC_*` read, so Next.js inlines the same value into the client
// bundle (the apply form) and the server (the apply endpoint and its evidence hash): both always
// agree on the version. Flipping the flag needs a redeploy; a form loaded before it then submits a
// superseded version and is asked to reload (portal.applyConsentVersionChanged).
export const ACTIVE_APPLICATION_CONSENT_VARIANT: ApplicationConsentVariant = resolveApplicationConsentVariant(
  process.env.NEXT_PUBLIC_LEY_8968_NOTICE_ENABLED,
);

export const APPLICATION_CONSENT_TEXT_VERSION = APPLICATION_CONSENT_VERSIONS[ACTIVE_APPLICATION_CONSENT_VARIANT];

export const APPLICATION_CONSENT_LOCALES = ['es', 'en'] as const;
export type ApplicationConsentLocale = (typeof APPLICATION_CONSENT_LOCALES)[number];

export interface ApplicationConsentTextParts {
  prefix: string;
  middle: string;
  policyLink: string;
  suffix: string;
}

// The EXACT text of each version, per locale. The portal renders it from the i18n catalogue
// (`portal.consentCheckbox*` for the default variant, `portalLey8968Consent.*` for Ley 8968);
// tests/portal/application-consent-evidence.test.ts and tests/portal/apply-consent-checkbox-drift.test.tsx
// fail if these copies ever drift, so the server-computed evidence hash always identifies the text
// the candidate was shown.
const DEFAULT_APPLICATION_CONSENT_TEXT: Record<ApplicationConsentLocale, ApplicationConsentTextParts> = {
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

// Costa Rica, Ley N.° 8968 — DRAFT pending counsel review (see LEY_8968_NOTICE_TEXT_FINAL).
const LEY_8968_APPLICATION_CONSENT_TEXT: Record<ApplicationConsentLocale, ApplicationConsentTextParts> = {
  es: {
    prefix: 'Autorizo de forma libre, expresa e informada a',
    middle:
      'para recopilar y tratar mis datos personales, incluida mi hoja de vida, con el fin de gestionar mi participación en sus procesos de selección de personal —lo que incluye su almacenamiento en servidores ubicados fuera de Costa Rica y el uso de herramientas automatizadas para organizar la información de mi hoja de vida—, de acuerdo con su',
    policyLink: 'aviso de privacidad para candidatos',
    suffix:
      ', conforme a la Ley N.° 8968. Sé que puedo acceder, rectificar o suprimir mis datos y revocar esta autorización en cualquier momento.',
  },
  en: {
    prefix: 'I freely, expressly and knowingly authorize',
    middle:
      'to collect and process my personal data, including my resume, in order to manage my participation in its recruitment and selection processes (including its storage on servers located outside Costa Rica and the use of automated tools to organize the information in my resume), in accordance with its',
    policyLink: 'privacy notice for candidates',
    suffix:
      ", under Costa Rica's Law No. 8968. I understand I can access, correct or delete my data and revoke this authorization at any time.",
  },
};

export const APPLICATION_CONSENT_TEXTS: Record<
  ApplicationConsentVariant,
  Record<ApplicationConsentLocale, ApplicationConsentTextParts>
> = {
  default: DEFAULT_APPLICATION_CONSENT_TEXT,
  ley8968: LEY_8968_APPLICATION_CONSENT_TEXT,
};

/** The text of APPLICATION_CONSENT_TEXT_VERSION: the variant this deployment shows. */
export const APPLICATION_CONSENT_TEXT = APPLICATION_CONSENT_TEXTS[ACTIVE_APPLICATION_CONSENT_VARIANT];

/**
 * The consent sentence exactly as the apply form's checkbox label reads it (its textContent):
 * `{prefix} {organization} {middle} {policyLink}{suffix}`. The organization is the data
 * controller — the tenant that owns the vacancy.
 */
export function renderApplicationConsentText(
  locale: ApplicationConsentLocale,
  controllerName: string,
  variant: ApplicationConsentVariant = ACTIVE_APPLICATION_CONSENT_VARIANT,
): string {
  const p = APPLICATION_CONSENT_TEXTS[variant][locale];
  return `${p.prefix} ${controllerName} ${p.middle} ${p.policyLink}${p.suffix}`;
}

// How an organization received a withdrawal it records on the candidate's behalf (#312).
// `portal` is reserved for the candidate's own self-service withdrawal.
export const CONSENT_WITHDRAWAL_CHANNELS = ['email', 'phone', 'in_person', 'letter', 'other'] as const;
export type ConsentWithdrawalChannel = (typeof CONSENT_WITHDRAWAL_CHANNELS)[number];
export const CONSENT_WITHDRAWAL_REASON_MAX = 500;
