'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { roleLabel } from '../../../../lib/role-labels';
import { canManageMember, primaryRoleSlug } from '../../../../lib/member-admin';
import { Button, DataTable, EmptyState, ErrorState, StatusBadge } from '../../../../components';
import { MemberRowActions } from './member-row-actions';

// Data source: the existing tenant-scoped `user.list` tRPC read (user:read, org from ctx). The C# people
// directory (#304) is not merged yet; swap this read for its client once it is. `isActive: true` hides
// deactivated and soft-deleted members (user.list pairs it with deletedAt: null).
//
// Each row shows the member's role, so an admin can verify who holds what, and — for members the admin may
// manage — "Cambiar rol…" (user:update) and "Desactivar…" (user:delete) (company-admin access-3 / ideal-78).
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

  if (members.isError)
    return <ErrorState message={m.membersError} onRetry={() => void members.refetch()} error={members.error} />;

  const rows = (members.data?.pages.flatMap((page) => page.users) ?? []).map((user) => {
    const roleSlugs = (user.userRoles ?? []).map((ur) => ur.role.slug);
    const role = primaryRoleSlug(roleSlugs);
    return {
      user,
      role,
      roleText: role ? roleLabel(t.roles, role) : m.memberNoRole,
      name: `${user.firstName} ${user.lastName}`.trim(),
      isSelf: user.id === userId,
      manageable: showActions && canManageMember({ id: userId, roles: actorRoles }, { id: user.id, roleSlugs }),
    };
  });
  const youChip = (
    <StatusBadge tone="brand" icon="none">
      {m.memberYou}
    </StatusBadge>
  );
  const actionsFor = (row: (typeof rows)[number], layout: 'buttons' | 'menu') =>
    row.manageable && (
      <MemberRowActions
        member={{ id: row.user.id, name: row.name }}
        currentRole={row.role}
        actorRoles={actorRoles}
        canChangeRole={canChangeRole}
        canDeactivate={canDeactivate}
        layout={layout}
      />
    );

  // Phones: a stacked list (name, email, role) with the row commands behind one menu (settings-07).
  const mobileList = (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.user.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-body font-medium text-primary">
              {row.name}
              {row.isSelf && youChip}
            </p>
            <p className="truncate text-callout text-secondary">{row.user.email}</p>
            <p className="text-callout text-secondary">{row.roleText}</p>
          </div>
          {actionsFor(row, 'menu')}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        loading={members.isLoading}
        label={m.membersTitle}
        mobileList={rows.length > 0 ? mobileList : undefined}
        columns={[
          { key: 'name', label: m.colName },
          { key: 'email', label: m.colEmail },
          { key: 'role', label: m.colRole },
          { key: 'jobTitle', label: m.colJobTitle },
          ...(showActions ? [{ key: 'actions', label: m.colActions, align: 'right' as const }] : []),
        ]}
        empty={<EmptyState message={m.membersEmpty} />}
      >
        {rows.map((row) => (
          <tr key={row.user.id} className="border-b border-border last:border-0">
            <td className="px-4 py-3 text-body text-primary">
              <span className="inline-flex flex-wrap items-center gap-2">
                {row.name}
                {row.isSelf && youChip}
              </span>
            </td>
            <td className="px-4 py-3 text-body text-secondary">{row.user.email}</td>
            <td className="px-4 py-3 text-body text-primary">{row.roleText}</td>
            <td className="px-4 py-3 text-body text-secondary">{row.user.jobTitle ?? ''}</td>
            {showActions && <td className="whitespace-nowrap px-4 py-3 text-right">{actionsFor(row, 'buttons')}</td>}
          </tr>
        ))}
      </DataTable>
      {members.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => void members.fetchNextPage()}
          disabled={members.isFetchingNextPage}
        >
          {m.loadMore}
        </Button>
      )}
    </div>
  );
}
