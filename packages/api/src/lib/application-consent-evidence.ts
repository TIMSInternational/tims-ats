import { createHash, createHmac } from 'node:crypto';
import { logger } from '@tims/shared';
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

// Server-held secret for the IP pseudonym. A plain (even org-salted) SHA-256 of an IPv4 address is
// reversible by enumerating 2^32 candidates, so it is NOT used: without the key no IP-derived value is stored.
export const CONSENT_IP_HMAC_KEY_ENV = 'CONSENT_EVIDENCE_IP_HMAC_KEY';
const MIN_KEY_LENGTH = 32;

/**
 * Pseudonymous IP: HMAC-SHA256(key, `<organizationId>:<ip>`) with a server-held key
 * (CONSENT_EVIDENCE_IP_HMAC_KEY, >= 32 chars). Whoever holds the key can check a KNOWN address against it
 * (the evidentiary use: was the authorization given from the address the data subject claims?); without
 * the key it cannot be reversed by enumeration. NULL when the key is absent/too short or no trusted client IP
 * is available — never a weaker unkeyed hash.
 */
export function consentIpHash(organizationId: string, headers: Headers): string | null {
  const key = process.env[CONSENT_IP_HMAC_KEY_ENV];
  if (!key || key.length < MIN_KEY_LENGTH) return null;
  const ip = clientIpFrom(headers);
  return ip ? createHmac('sha256', key).update(`${organizationId}:${ip}`, 'utf8').digest('hex') : null;
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

type EvidenceTx = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  applicationConsentEvidence: {
    create: (args: { data: ApplicationConsentEvidenceRow; select: { id: true } }) => Promise<unknown>;
  };
};

// P2021 = table does not exist, P2022 = column does not exist (Prisma known-request error codes).
const MISSING_SCHEMA_CODES = new Set(['P2021', 'P2022']);

/**
 * Writes the evidence row inside the caller's transaction behind a SAVEPOINT. If the table or a column is
 * missing (this code deployed before migration 20261001120000_consent_evidence_withdrawal), the savepoint is
 * rolled back — Postgres would otherwise abort the whole transaction, i.e. the application itself — and the
 * omission is logged (no PII). Every other error propagates and aborts the application, so an application is
 * never committed without its proof once the table exists.
 */
export async function writeConsentEvidence(tx: EvidenceTx, row: ApplicationConsentEvidenceRow): Promise<boolean> {
  await tx.$executeRaw`SAVEPOINT consent_evidence`;
  try {
    await tx.applicationConsentEvidence.create({ data: row, select: { id: true } });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && MISSING_SCHEMA_CODES.has(code)) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT consent_evidence`;
      logger.error(
        { component: 'portal', organizationId: row.organizationId, code },
        'Consent evidence NOT recorded: application_consent_evidence is missing — apply migration 20261001120000',
      );
      return false;
    }
    throw err;
  }
  await tx.$executeRaw`RELEASE SAVEPOINT consent_evidence`;
  return true;
}
