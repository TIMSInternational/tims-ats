'use client';

import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';
import { useCan } from '../../../lib/permissions';
import { isTenantInvitationsEnabled } from '../../../lib/platform-api/tenant-invitations';

/**
 * The two things an admin or recruiter most often starts from the landing page. Each link shows only when
 * it can succeed: "Nueva vacante" with vacancy:create (it opens the wizard on the vacancies page), and
 * "Invitar al equipo" with user:create while tenant invitations are on (same gate as the setup checklist).
 */
export function RecruiterQuickActions() {
  const { t } = useI18n();
  const can = useCan();
  const rd = t.recruitingDashboard;
  const canCreateVacancy = can('vacancy', 'create');
  const canInvite = can('user', 'create') && isTenantInvitationsEnabled();

  if (!canCreateVacancy && !canInvite) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canInvite && (
        <Link
          href="/settings/users"
          className="h-8 px-3 rounded-lg border border-[#EDEDED] bg-white text-[12px] font-medium text-[#585858] hover:bg-[#F6F6F6] transition flex items-center"
        >
          {rd.quickInviteTeam}
        </Link>
      )}
      {canCreateVacancy && (
        <Link
          href="/recruitment/vacancies?create=1"
          className="h-8 px-3 rounded-lg bg-[#DD0C15] text-white text-[12px] font-medium hover:bg-[#c00b13] transition flex items-center"
        >
          {rd.quickNewVacancy}
        </Link>
      )}
    </div>
  );
}
