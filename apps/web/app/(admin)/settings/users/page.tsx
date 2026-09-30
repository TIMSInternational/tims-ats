'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, Skeleton } from '../../../../components';
import { isTenantInvitationsEnabled } from '../../../../lib/platform-api/tenant-invitations';
import { InviteForm } from './invite-form';
import { PendingInvitationsTable } from './pending-invitations-table';
import { MembersTable } from './members-table';

const SECTION_CLS = 'bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]';
const HEADING_CLS = 'text-sm font-semibold text-[#1F114C] mb-4';

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

  let inviteBody: ReactNode;
  if (!invitationsEnabled)
    inviteBody = <EmptyState icon={null} message={m.unavailableTitle} description={m.unavailableMessage} />;
  else if (isLoading) inviteBody = <Skeleton className="h-24 w-full rounded-xl" />;
  else if (!canInvite)
    inviteBody = <EmptyState icon={null} message={m.noPermissionTitle} description={m.noPermissionMessage} />;
  else inviteBody = <InviteForm />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#1F114C]">{m.title}</h1>
        <p className="mt-1 text-sm text-[#8B8B8B]">{m.subtitle}</p>
      </header>

      <section className={SECTION_CLS} aria-labelledby="team-invite-heading">
        <h2 id="team-invite-heading" className={HEADING_CLS}>
          {m.inviteTitle}
        </h2>
        {inviteBody}
      </section>

      {invitationsEnabled && !isLoading && canInvite && (
        <section aria-labelledby="team-pending-heading" className="flex flex-col">
          <h2 id="team-pending-heading" className={HEADING_CLS}>
            {m.pendingTitle}
          </h2>
          <PendingInvitationsTable />
        </section>
      )}

      <section aria-labelledby="team-members-heading" className="flex flex-col">
        <h2 id="team-members-heading" className={HEADING_CLS}>
          {m.membersTitle}
        </h2>
        <MembersTable />
      </section>
    </div>
  );
}
