'use client';

import { useI18n } from '../../../lib/i18n';
import { Button } from '../../../components/button';
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

  // Secondary first, then the page's one primary (navy) action trailing (foundation §5).
  return (
    <>
      {canInvite && (
        <Button href="/settings/users" variant="secondary">
          {rd.quickInviteTeam}
        </Button>
      )}
      {canCreateVacancy && <Button href="/recruitment/vacancies?create=1">{rd.quickNewVacancy}</Button>}
    </>
  );
}
