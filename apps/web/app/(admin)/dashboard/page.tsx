import { PlatformDashboard } from './platform-dashboard';
import { RecruitmentDashboard } from './recruitment-dashboard';
import { UnassignedDashboard } from './unassigned-dashboard';
import { getEffectiveIdentity } from '../../../lib/auth/effective-identity';
import { pickPrimaryDashboard } from './pick-dashboard';

export default async function DashboardPage() {
  // Effective (impersonation-aware) identity: when a platform owner impersonates an
  // org user, this resolves to the target so the page renders their dashboard, not
  // PlatformDashboard. Staff guard + /login,/logout redirects live in the helper.
  const { effective } = await getEffectiveIdentity();

  // Platform owner (not impersonating) sees the platform dashboard.
  if (effective.isPlatformOwner) {
    return <PlatformDashboard />;
  }

  // A linked account without an assignable staff role cannot use a role-native
  // dashboard. Give the user a clear next step without issuing dashboard queries.
  if (pickPrimaryDashboard(effective.roleSlugs) === 'unassigned') {
    return <UnassignedDashboard email={effective.email} />;
  }

  // Org users (incl. an impersonated target) see the recruitment dashboard.
  return <RecruitmentDashboard roleSlugs={effective.roleSlugs} />;
}
