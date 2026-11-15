'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../lib/i18n/format';
import { getInitials, getAvatarColor, formatRelativeTimeLocale } from '../../../../../../lib/format-utils';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  selectClasses,
} from '../../../../../../components';
import { InviteUserModal } from '../../../invitations/invite-user-modal';
import { roleLabel, staffRoleOptions } from '../../../../../../lib/role-labels';

// Picking a role no longer applies it on the spot: a confirmation names the old and the new role first
// (D-14). Owner support requests change pilot tenant roles from here.
function RoleSelector({ userId, userName, organizationId, currentRole, fullWidth }: { userId: string; userName: string; organizationId: string; currentRole: string; fullWidth?: boolean }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const changeRole = trpc.platform.changeOrgUserRole.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast(t.users.roleUpdated, { type: 'success' });
      setPendingRole(null);
    },
    onError: (err) => { toast(err.message || t.common.error, { type: 'error' }); },
  });

  return (
    <>
      <select
        value={currentRole}
        disabled={changeRole.isPending}
        aria-label={`${t.users.role} — ${userName}`}
        onChange={(e) => {
          if (e.target.value !== currentRole) setPendingRole(e.target.value);
        }}
        className={selectClasses('md', fullWidth ? 'w-full' : 'w-auto min-w-36')}
      >
        {staffRoleOptions(t.roles, { keep: currentRole }).map((r) => (
          <option key={r.slug} value={r.slug}>{r.label}</option>
        ))}
      </select>
      {pendingRole && (
        <ConfirmDialog
          title={t.users.roleChangeConfirmTitle.replace('{name}', userName)}
          description={t.users.roleChangeConfirmMessage
            .replace('{from}', roleLabel(t.roles, currentRole))
            .replace('{to}', roleLabel(t.roles, pendingRole))}
          confirmLabel={t.users.roleChangeConfirm}
          loading={changeRole.isPending}
          onConfirm={() => changeRole.mutate({ userId, organizationId, roleSlug: pendingRole })}
          onCancel={() => setPendingRole(null)}
        />
      )}
    </>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border" aria-hidden="true">
      <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-3.5 w-28" /></div></td>
      <td className="px-4 py-3"><Skeleton className="h-3 w-36" /></td>
      <td className="px-4 py-3"><Skeleton className="h-7 w-28" /></td>
      <td className="px-4 py-3"><Skeleton className="h-3 w-20" /></td>
      <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
      <td className="px-4 py-3"><Skeleton className="h-3 w-16" /></td>
      <td className="px-4 py-3"><Skeleton className="h-7 w-20" /></td>
    </tr>
  );
}

const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';

export function UsersSection({ organizationId, organizationName }: { organizationId: string; organizationName?: string }) {
  const { t, locale } = useI18n();
  const ou = t.organizations;
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; name: string } | null>(null);
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.platform.getOrgUsers.useQuery({ organizationId });

  const deactivateUser = trpc.platform.deactivateOrgUser.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast(t.users.userDeactivatedOrg, { type: 'success' });
    },
    onError: (err) => { toast(err.message || ou.deactivateUserError, { type: 'error' }); },
  });

  const activateUser = trpc.platform.activateOrgUser.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast(t.users.userActivatedOrg, { type: 'success' });
    },
    onError: (err) => { toast(err.message || ou.activateUserError, { type: 'error' }); },
  });

  const users = data?.users ?? [];

  const rows = users.map((user) => {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || ou.noName;
    const roleSlug = user.isPlatformOwner ? 'platform_owner' : user.userRoles?.[0]?.role?.slug || 'employee';
    return { user, fullName, roleSlug };
  });
  const statusBadge = (isActive: boolean) => (
    <StatusBadge tone={isActive ? 'success' : 'neutral'}>{isActive ? t.users.statusActive : t.users.statusInactive}</StatusBadge>
  );
  const roleCell = (user: (typeof users)[number], fullName: string, roleSlug: string, fullWidth = false) => {
    if (user.isPlatformOwner) return <StatusBadge tone="brand" icon="none">{t.roles.platform_owner}</StatusBadge>;
    return <RoleSelector userId={user.id} userName={fullName} organizationId={organizationId} currentRole={roleSlug} fullWidth={fullWidth} />;
  };
  const actionCell = (user: (typeof users)[number], fullName: string, fullWidth = false) => {
    if (user.isActive) {
      return (
      <Button
        size="sm"
        fullWidth={fullWidth}
        variant="destructive-secondary"
        disabled={deactivateUser.isPending}
        aria-label={formatMessage(ou.deactivateUserFor, { name: fullName })}
        onClick={() => setDeactivateTarget({ id: user.id, name: fullName })}
      >
        {ou.deactivateEllipsis}
      </Button>
      );
    }
    return (
      <Button
        size="sm"
        fullWidth={fullWidth}
        variant="secondary"
        disabled={activateUser.isPending}
        aria-label={formatMessage(ou.activateUserFor, { name: fullName })}
        onClick={() => activateUser.mutate({ userId: user.id, organizationId })}
      >
        {t.users.activate}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-subheading font-semibold text-primary">{formatMessage(ou.usersCount, { count: data?.total ?? 0 })}</h2>
        <Button
          onClick={() => setShowInviteModal(true)}
          icon={<svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}
        >
          {t.invitations.inviteUser}
        </Button>
      </div>

      {showInviteModal && (
        <InviteUserModal
          preselectedOrgId={organizationId}
          preselectedOrgName={organizationName}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false);
            utils.platform.getOrgUsers.invalidate({ organizationId });
          }}
        />
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-card">
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !isLoading && users.length === 0 ? (
          <EmptyState title={ou.noUsersInOrgTitle} description={ou.noUsersInOrgDesc} />
        ) : (
          <>
            {/* Below md: a stacked list, so the role picker and the row action get the full width instead of
                being clipped at the right edge (layout.md › Size classes). */}
            <ul className="divide-y divide-border md:hidden" aria-label={t.users.title} aria-busy={isLoading || undefined}>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="space-y-2 px-4 py-3" aria-hidden="true">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-52" />
                      <Skeleton className="h-9 w-full" />
                    </li>
                  ))
                : rows.map(({ user, fullName, roleSlug }) => (
                    <li key={user.id} className="space-y-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-body font-medium text-primary">{fullName}</p>
                        <p className="break-all text-callout text-secondary">{user.email}</p>
                        <div className="mt-1">{statusBadge(user.isActive)}</div>
                      </div>
                      <div>{roleCell(user, fullName, roleSlug, true)}</div>
                      {actionCell(user, fullName, true)}
                    </li>
                  ))}
            </ul>
            <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-left" aria-busy={isLoading || undefined}>
              <caption className="sr-only">{t.users.title}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TH}>{t.users.colUser}</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>{t.common.email}</th>
                  <th scope="col" className={TH}>{t.users.colRole}</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>{ou.colJobTitle}</th>
                  <th scope="col" className={`${TH} hidden md:table-cell`}>{t.common.status}</th>
                  <th scope="col" className={`${TH} hidden lg:table-cell`}>{t.users.lastLogin}</th>
                  <th scope="col" className={TH}><span className="sr-only">{t.common.actions}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                  : rows.map(({ user, fullName, roleSlug }) => (
                      <tr key={user.id} className="hover:bg-surface-hover">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`hidden size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white sm:flex ${user.isActive ? getAvatarColor(fullName) : 'bg-secondary'}`} aria-hidden="true">{getInitials(fullName)}</div>
                            <div className="min-w-0">
                              <span className="block text-body font-medium text-primary">{fullName}</span>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-2.5 text-callout text-secondary md:table-cell">{user.email}</td>
                        <td className="px-4 py-2.5">{roleCell(user, fullName, roleSlug)}</td>
                        <td className="hidden px-4 py-2.5 text-callout text-secondary lg:table-cell">{user.jobTitle || '\u2014'}</td>
                        <td className="hidden px-4 py-2.5 md:table-cell">{statusBadge(user.isActive)}</td>
                        <td className="hidden px-4 py-2.5 text-callout text-secondary lg:table-cell">{formatRelativeTimeLocale(user.lastLoginAt, locale, ou.never)}</td>
                        <td className="px-4 py-2.5">{actionCell(user, fullName)}</td>
                      </tr>
                    ))}
              </tbody>
            </table></div>
          </>
        )}
      </div>
      {deactivateTarget && (
        <ConfirmDialog
          title={formatMessage(ou.confirmDeactivateUserTitle, { name: deactivateTarget.name })}
          description={t.users.willLoseAccess}
          confirmLabel={ou.deactivateUserBtn}
          destructive
          onConfirm={() => {
            deactivateUser.mutate({ userId: deactivateTarget.id, organizationId });
            setDeactivateTarget(null);
          }}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
    </div>
  );
}
