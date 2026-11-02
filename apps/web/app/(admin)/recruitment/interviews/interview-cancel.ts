// Pure helpers for cancelling an interview from the interviews list (no React imports → node-testable).

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

/** Bounded to the API's cancelReason (1..1000); blank falls back to the default copy. */
export const CANCEL_REASON_MAX = 1000;
export function resolveCancelReason(raw: string, fallback: string): string {
  const value = raw.trim().slice(0, CANCEL_REASON_MAX);
  return value || fallback;
}
