// ── Public job-application consent (Colombia Ley 1581 de 2012 / Decreto 1377 de 2013) ──
// A candidate applying through the public careers portal must give PRIOR, EXPRESS and
// INFORMED authorization before their personal data is processed. The portal renders an
// unchecked checkbox naming the organization and the purpose; `portal.applyToVacancy`
// rejects any submission that does not carry `consentAccepted: true` with the CURRENT
// text version, and records the authorization as a DataConsent row.
//
// Bump APPLICATION_CONSENT_TEXT_VERSION whenever the consent wording (es/en
// `portal.consentCheckbox*` keys) or the linked privacy notice materially changes, so the
// stored row always identifies the text the candidate actually agreed to.
export const APPLICATION_CONSENT_TYPE = 'recruitment_data_processing';
export const APPLICATION_CONSENT_TEXT_VERSION = 'portal-apply-2026-09-29';
