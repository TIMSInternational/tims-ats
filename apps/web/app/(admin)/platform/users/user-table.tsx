'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { Button, DataTable, EmptyState, Menu, StatusBadge } from '../../../../components';
import type { MenuEntry } from '../../../../components';
import { formatDate, formatRelativeTimeLocale, getInitials, getAvatarColor } from '../../../../lib/format-utils';
import { MFA_REQUIRED } from '@tims/shared';
import { roleLabel } from '../../../../lib/role-labels';
import type { UserListItem } from '../../../../lib/trpc-types';

interface UserTableProps {
  users: UserListItem[];
  isLoading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onDeactivate: (user: UserListItem) => void;
  onActivate: (user: UserListItem) => void;
  onEditRole: (user: UserListItem) => void;
}

export function UserTable({
  users,
  isLoading,
  page,
  limit,
  total,
  onPageChange,
  onDeactivate,
  onActivate,
  onEditRole,
}: UserTableProps) {
  const { t, locale } = useI18n();
  const u = t.users;

  const columns = [
    { key: 'user', label: u.colUser },
    { key: 'email', label: u.colEmail },
    { key: 'org', label: u.colOrganization },
    { key: 'role', label: u.colRole },
    { key: 'status', label: u.colStatus },
    { key: 'lastLogin', label: u.colLastLogin },
    { key: 'created', label: u.colCreated },
    { key: 'actions', label: u.colActions, align: 'right' as const, srOnly: true },
  ];

  const emptyIcon = (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );

  // Signs the owner in as this person right away (no dialog), so the item carries no ellipsis.
  const impersonate = async (user: UserListItem) => {
    try {
      const res = await fetch('/api/impersonate/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        // CB-2a: when MFA is enforced an aal1 owner must step up
        // before impersonating — route them to /mfa.
        if (res.status === 403) {
          const body = await res.json().catch(() => null);
          if (body?.error === MFA_REQUIRED) {
            window.location.href = '/mfa';
            return;
          }
        }
        throw new Error();
      }
      // Hard navigation so the server layout + tRPC context re-resolve as the target.
      window.location.href = '/dashboard';
    } catch {
      toast(u.impersonateError, { type: 'error' });
    }
  };

  const describe = (user: UserListItem) => {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || t.organizations.noName;
    const roleSlug = user.isPlatformOwner ? 'platform_owner' : user.userRoles?.[0]?.role?.slug || 'employee';
    return { fullName, roleSlug };
  };

  const actions = (user: UserListItem, fullName: string) => {
    const items: MenuEntry[] = [{ key: 'role', label: u.changeRoleEllipsis, onSelect: () => onEditRole(user) }];
    if (!user.isPlatformOwner && user.isActive) {
      items.push({ key: 'impersonate', label: u.impersonateAs, onSelect: () => void impersonate(user) });
      items.push({ key: 'sep', type: 'separator' });
      items.push({ key: 'deactivate', label: u.deactivateEllipsis, destructive: true, onSelect: () => onDeactivate(user) });
    }
    if (!user.isPlatformOwner && !user.isActive) {
      items.push({ key: 'activate', label: u.activateEllipsis, onSelect: () => onActivate(user) });
    }
    return (
      <div className="flex items-center justify-end gap-1">
        {user.organizationId && (
          <Button size="sm" variant="tertiary" href={`/platform/organizations/${user.organizationId}?tab=users`}>
            {u.view}
          </Button>
        )}
        <Menu items={items} label={formatMessage(u.moreActionsFor, { name: fullName })} />
      </div>
    );
  };

  const status = (user: UserListItem) => (
    <StatusBadge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? u.statusActive : u.statusInactive}</StatusBadge>
  );

  return (
    <DataTable
      columns={columns}
      label={u.title}
      loading={isLoading}
      empty={<EmptyState icon={emptyIcon} message={u.noUsersFound} description={u.adjustFilters} />}
      pagination={{ page, limit, total, onPageChange }}
      mobileList={users.map((user) => {
        const { fullName, roleSlug } = describe(user);
        return (
          <div key={user.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-body font-medium text-primary">{fullName}</p>
              <p className="break-all text-callout text-secondary">{user.email}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone="brand" icon="none">{roleLabel(t.roles, roleSlug)}</StatusBadge>
                {status(user)}
              </div>
            </div>
            {actions(user, fullName)}
          </div>
        );
      })}
    >
      {users.map((user) => {
        const { fullName, roleSlug } = describe(user);
        return (
          <tr key={user.id} className="border-b border-border hover:bg-surface-hover">
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white ${user.isActive ? getAvatarColor(fullName) : 'bg-secondary'}`} aria-hidden="true">
                  {getInitials(fullName)}
                </div>
                <span className="text-body font-medium text-primary">{fullName}</span>
              </div>
            </td>
            <td className="px-4 py-2.5 text-callout text-secondary">{user.email}</td>
            <td className="px-4 py-2.5 text-callout text-secondary">
              {user.isPlatformOwner ? u.platform : user.organization?.name || '—'}
            </td>
            <td className="px-4 py-2.5">
              <StatusBadge tone="brand" icon="none">{roleLabel(t.roles, roleSlug)}</StatusBadge>
            </td>
            <td className="px-4 py-2.5">{status(user)}</td>
            <td className="px-4 py-2.5 text-callout text-secondary">
              {formatRelativeTimeLocale(user.lastLoginAt, locale, t.organizations.never)}
            </td>
            <td className="px-4 py-2.5 text-callout text-secondary">{formatDate(user.createdAt)}</td>
            <td className="px-4 py-2.5">{actions(user, fullName)}</td>
          </tr>
        );
      })}
    </DataTable>
  );
}
