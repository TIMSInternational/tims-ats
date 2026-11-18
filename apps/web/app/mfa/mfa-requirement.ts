import { isMfaEnforced, isMfaPrivileged } from '../../lib/mfa';

// Whether two-step verification is MANDATORY for this staff user — the exact rule the (admin) layout
// gate and the tRPC MFA middleware enforce (MFA_ENFORCED on + platform owner / super_admin), so the
// /mfa page can explain why the user was sent there, never offer "Desactivar", and never offer a
// "Volver al panel" link that would only loop back. Pure: the page loads `staff` from the database.
export function isMfaRequiredFor(
  enforcedFlag: string | undefined,
  staff: { isPlatformOwner: boolean; roleSlugs: string[] } | null,
): boolean {
  if (!isMfaEnforced(enforcedFlag) || !staff) return false;
  return isMfaPrivileged({ roles: staff.roleSlugs, isPlatformOwner: staff.isPlatformOwner });
}
