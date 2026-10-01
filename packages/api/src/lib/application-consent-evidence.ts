import { createHash } from 'node:crypto';
import { APPLICATION_CONSENT_TYPE, renderApplicationConsentText, type ApplicationConsentLocale } from '@tims/shared';
import { clientIpFrom } from './client-ip';

// Per-application consent evidence (#313). Everything here is derived SERVER-side: the text hash
// is computed from the canonical text of the version the request carried (never a client hash),
// and the request metadata is bounded and pseudonymous.
export const CONSENT_EVIDENCE_USER_AGENT_MAX = 512;

export interface ApplicationConsentEvidenceInput {
  organizationId: string;
  applicationId: string;
  candidateId: string;
  textVersion: string;
  locale: ApplicationConsentLocale;
  controllerName: string;
  agreedAt: Date;
  headers: Headers;
  captchaVerified: boolean;
}

export interface ApplicationConsentEvidenceRow {
  organizationId: string;
  applicationId: string;
  candidateId: string;
  consentType: string;
  textVersion: string;
  textSha256: string;
  locale: ApplicationConsentLocale;
  agreedAt: Date;
  ipHash: string | null;
  userAgent: string | null;
  captchaVerified: boolean;
  isBackfilled: false;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256 of the exact consent sentence the form shows for this locale and data controller. */
export function consentTextSha256(locale: ApplicationConsentLocale, controllerName: string): string {
  return sha256Hex(renderApplicationConsentText(locale, controllerName));
}

/**
 * Pseudonymous IP: SHA-256 of `<organizationId>:<ip>`. It cannot be read back as an address, but a
 * KNOWN address can be checked against it — which is the evidentiary use (was the authorization
 * given from the address the data subject claims?). Org-salted so one value never joins across
 * tenants. NULL when no trusted client IP is available.
 */
export function consentIpHash(organizationId: string, headers: Headers): string | null {
  const ip = clientIpFrom(headers);
  return ip ? sha256Hex(`${organizationId}:${ip}`) : null;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** User agent, control characters stripped and truncated to the column bound. */
export function boundedUserAgent(headers: Headers): string | null {
  const raw = headers.get('user-agent')?.replace(CONTROL_CHARS, '').trim();
  return raw ? raw.slice(0, CONSENT_EVIDENCE_USER_AGENT_MAX) : null;
}

export function buildApplicationConsentEvidence(input: ApplicationConsentEvidenceInput): ApplicationConsentEvidenceRow {
  return {
    organizationId: input.organizationId,
    applicationId: input.applicationId,
    candidateId: input.candidateId,
    consentType: APPLICATION_CONSENT_TYPE,
    textVersion: input.textVersion,
    textSha256: consentTextSha256(input.locale, input.controllerName),
    locale: input.locale,
    agreedAt: input.agreedAt,
    ipHash: consentIpHash(input.organizationId, input.headers),
    userAgent: boundedUserAgent(input.headers),
    captchaVerified: input.captchaVerified,
    isBackfilled: false,
  };
}
