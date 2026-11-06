// /settings/audit-log export filters (audit findings D-13, E-28). Pure (no React) so node tests can
// exercise it.
//
// 1. The action and entity filters are exact matches against internal codes (TS and C# both compare with
//    `==`). Free text asked admins to guess English slugs that are never stored ("create, update"), so the
//    page offers these known codes, labelled in Spanish through i18n `auditExport.actions` / `.entities`.
//    Each list holds the codes the TS and C# writers actually store and an organization admin can act on.
// 2. A date input yields "YYYY-MM-DD". `new Date('YYYY-MM-DD')` is UTC midnight, so "Hasta 09/11" ended
//    the export at 08/11 18:00 in Costa Rica and dropped the chosen day. Both ends are now the start and the
//    end of the chosen days in the ORGANIZATION's time zone (both backends compare `>= from` and `<= to`).

import { UTC_TIME_ZONE, isValidTimeZone, zonedWallTimeToDate } from '@tims/shared';

export const AUDIT_ACTION_CODES = [
  'access',
  'authz_denied',
  'mfa_step_up_required',
  'role_assigned',
  'user_role_changed',
  'user_deactivated',
  'user_activated',
  'user_invitation_created',
  'invitation_resend',
  'user_invitation_revoked',
  'vacancy_approval_withdrawn',
  'offer_approval_withdrawn',
  'interview_scorecard_resubmitted',
  'candidate_consent_withdrawn',
  'data_subject_export',
  'impersonation_started',
  'impersonation_stopped',
  'password_reset_requested',
  'sessions_revoked',
  'org_updated',
] as const;
export type AuditActionCode = (typeof AUDIT_ACTION_CODES)[number];

export const AUDIT_ENTITY_CODES = [
  'user',
  'user_role',
  'platform_invitation',
  'organization',
  'candidate',
  'vacancy',
  'offer',
  'interview_scorecard',
  'mfa',
  'data_subject',
] as const;
export type AuditEntityCode = (typeof AUDIT_ENTITY_CODES)[number];

export type AuditFilterOption = { value: string; label: string };

/** Options for a select, labelled from the i18n map, in the order of `codes`. */
export function auditFilterOptions<C extends string>(
  codes: readonly C[],
  labels: Readonly<Record<C, string>>,
): AuditFilterOption[] {
  return codes.map((value) => ({ value, label: labels[value] }));
}

function nextDay(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return next.toISOString().slice(0, 10);
}

export interface AuditExportRange {
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * The export window for the chosen calendar days in `timeZone` (else UTC): `dateFrom` is 00:00:00.000 of
 * the first day, `dateTo` the last millisecond of the last day. An empty or malformed input leaves that end
 * open.
 */
export function auditExportRange(from: string, to: string, timeZone: string | null | undefined): AuditExportRange {
  const zone = isValidTimeZone(timeZone) ? timeZone : UTC_TIME_ZONE;
  const range: AuditExportRange = {};
  if (from) {
    const start = zonedWallTimeToDate(from, '00:00', zone);
    if (start) range.dateFrom = start;
  }
  if (to) {
    const following = nextDay(to);
    const end = following ? zonedWallTimeToDate(following, '00:00', zone) : null;
    if (end) range.dateTo = new Date(end.getTime() - 1);
  }
  return range;
}

/** True when both days are set and `from` is after `to` (an export that could only be empty). */
export function isAuditRangeInverted(from: string, to: string): boolean {
  return Boolean(from && to && from > to);
}
