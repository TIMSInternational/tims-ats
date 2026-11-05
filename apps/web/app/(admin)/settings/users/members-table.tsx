'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { roleLabel } from '../../../../lib/role-labels';
import { canManageMember, primaryRoleSlug } from '../../../../lib/member-admin';
import { DataTable, EmptyState, ErrorState } from '../../../../components';
import { MemberRowActions } from './member-row-actions';

// Data source: the existing tenant-scoped `user.list` tRPC read (user:read, org from ctx). The C# people
// directory (#304) is not merged yet; swap this read for its client once it is. `isActive: true` hides
// deactivated and soft-deleted members (user.list pairs it with deletedAt: null).
//
// Each row shows the member's role, so an admin can verify who holds what, and — for members the admin may
// manage — "Cambiar rol" (user:update) and "Desactivar" (user:delete) (company-admin access-3 / ideal-78).
export function MembersTable() {
  const { t } = useI18n();
  const m = t.teamSettings;
  const { can, roles: actorRoles, userId } = usePermissions();
  const canChangeRole = can('user', 'update');
  const canDeactivate = can('user', 'delete');
  const showActions = canChangeRole || canDeactivate;
  const members = trpc.user.list.useInfiniteQuery(
    { limit: 50, isActive: true },
    { getNextPageParam: (last) => last.nextCursor, retry: false },
  );

  if (members.isError) return <ErrorState message={m.membersError} onRetry={() => void members.refetch()} />;

  const rows = members.data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        loading={members.isLoading}
        columns={[
          { key: 'name', label: m.colName },
          { key: 'email', label: m.colEmail },
          { key: 'role', label: m.colRole },
          { key: 'jobTitle', label: m.colJobTitle },
          ...(showActions ? [{ key: 'actions', label: m.colActions, align: 'right' as const }] : []),
        ]}
        empty={<EmptyState icon={null} message={m.membersEmpty} />}
      >
        {rows.map((user) => {
          const roleSlugs = (user.userRoles ?? []).map((ur) => ur.role.slug);
          const role = primaryRoleSlug(roleSlugs);
          const name = `${user.firstName} ${user.lastName}`.trim();
          const isSelf = user.id === userId;
          const manageable = showActions && canManageMember({ id: userId, roles: actorRoles }, { id: user.id, roleSlugs });
          return (
            <tr key={user.id} className="border-b border-[#EDEDED] last:border-0">
              <td className="px-4 py-3 text-sm text-[#333]">
                {name}
                {isSelf && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-[#1F114C]/10 text-[10px] font-semibold text-[#1F114C]">
                    {m.memberYou}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[#585858]">{user.email}</td>
              <td className="px-4 py-3 text-sm text-[#333]">{role ? roleLabel(t.roles, role) : m.memberNoRole}</td>
              <td className="px-4 py-3 text-sm text-[#585858]">{user.jobTitle ?? ''}</td>
              {showActions && (
                <td className="px-4 py-3 text-right">
                  {manageable && (
                    <MemberRowActions
                      member={{ id: user.id, name }}
                      currentRole={role}
                      actorRoles={actorRoles}
                      canChangeRole={canChangeRole}
                      canDeactivate={canDeactivate}
                    />
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </DataTable>
      {members.hasNextPage && (
        <button
          type="button"
          onClick={() => void members.fetchNextPage()}
          disabled={members.isFetchingNextPage}
          className="self-center h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#1F114C] hover:bg-[#F7F7F7] transition disabled:opacity-50"
        >
          {m.loadMore}
        </button>
      )}
    </div>
  );
}
