// Pure helpers for the interview-management actions of the interviews list (no React imports →
// node-testable).

// Roles that run interviews (schedule / reschedule / cancel). A committee member only sits on panels.
const INTERVIEW_MANAGER_ROLES = ['platform_owner', 'super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader'] as const;

/** Whether the Cancel action is offered. `can()` cannot tell a committee member from a recruiter (both
 *  may hold interview grants), so a user whose ONLY interview-related role is committee is excluded by
 *  role slug. UX only — the API stays the gate (interview:update). */
export function canOfferInterviewCancel(roles: readonly string[], canUpdateInterview: boolean): boolean {
  if (!canUpdateInterview) return false;
  const isManager = INTERVIEW_MANAGER_ROLES.some((r) => roles.includes(r));
  if (isManager) return true;
  return !roles.includes('committee');
}

/** Whether the panel can be managed from the list ("Gestionar evaluadores"): same people as Cancel. The
 *  API enforces it too (a panelist's interview:update no longer reaches add/remove evaluator). */
export function canOfferPanelManagement(roles: readonly string[], canUpdateInterview: boolean): boolean {
  return canOfferInterviewCancel(roles, canUpdateInterview);
}

/** Whether "Programar entrevista" is offered: an interview manager who can also search candidates and
 *  pick vacancies — the modal's two pickers need candidate:read and vacancy:read, which committee lacks. */
export function canOfferInterviewScheduling(
  roles: readonly string[],
  can: (module: string, action?: string) => boolean,
): boolean {
  return canOfferInterviewCancel(roles, can('interview', 'create')) && can('candidate', 'read') && can('vacancy', 'read');
}

/** Bounded to the API's cancelReason (1..1000); blank falls back to the default copy. */
export const CANCEL_REASON_MAX = 1000;
export function resolveCancelReason(raw: string, fallback: string): string {
  const value = raw.trim().slice(0, CANCEL_REASON_MAX);
  return value || fallback;
}
