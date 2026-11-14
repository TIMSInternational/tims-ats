'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, PageHeader, Skeleton } from '../../../../components';
import { isTenantInvitationsEnabled, useTenantInvitationRoles } from '../../../../lib/platform-api/tenant-invitations';
import { InviteForm } from './invite-form';
import { PendingInvitationsTable } from './pending-invitations-table';
import { MembersTable } from './members-table';
import { isInvitationForbidden } from './invitation-error-message';

const SECTION_CLS = 'rounded-xl bg-white p-5 shadow-card';
const HEADING_CLS = 'text-subheading font-semibold text-primary';

function ForbiddenLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-callout text-secondary">
      <svg
        className="size-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      {text}
    </p>
  );
}

// /settings/users ("Equipo"): a company admin invites their own team into THEIR org (finding F8).
// The route itself is gated on user:read (lib/nav/routes.ts) so the member list is visible to
// readers; inviting and managing invitations additionally needs user:create, and the C# surface
// behind NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP. The API remains the real boundary.
export default function TeamSettingsPage() {
  const { t } = useI18n();
  const m = t.teamSettings;
  const { can, isLoading } = usePermissions();
  const invitationsEnabled = isTenantInvitationsEnabled();
  const canInvite = can('user', 'create');
  const inviteAllowed = invitationsEnabled && !isLoading && canInvite;
  // The same roles query the invite form runs (shared cache key): no extra request. A 401/403 means this
  // role can read members but not invite, which is one line, not two full "no access" blocks (settings-17).
  const roles = useTenantInvitationRoles(inviteAllowed);
  const inviteForbidden = inviteAllowed && roles.isError && isInvitationForbidden(roles.error);

  let inviteBody: ReactNode;
  if (!invitationsEnabled)
    inviteBody = <EmptyState icon={null} message={m.unavailableTitle} description={m.unavailableMessage} />;
  else if (isLoading) inviteBody = <Skeleton className="h-24 w-full rounded-xl" />;
  else if (!canInvite)
    inviteBody = <EmptyState icon={null} message={m.noPermissionTitle} description={m.noPermissionMessage} />;
  else inviteBody = <InviteForm />;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={m.title} description={m.subtitle} />

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {inviteForbidden ? (
          <ForbiddenLine text={m.inviteForbiddenLine} />
        ) : (
          <section className={SECTION_CLS} aria-labelledby="team-invite-heading">
            <h2 id="team-invite-heading" className={`mb-4 ${HEADING_CLS}`}>
              {m.inviteTitle}
            </h2>
            {inviteBody}
          </section>
        )}

        {inviteAllowed && !inviteForbidden && <PendingInvitationsTable headingClassName={HEADING_CLS} />}

        <section aria-labelledby="team-members-heading" className="flex flex-col">
          <h2 id="team-members-heading" className={`mb-4 ${HEADING_CLS}`}>
            {m.membersTitle}
          </h2>
          <MembersTable />
        </section>
      </div>
    </div>
  );
}
