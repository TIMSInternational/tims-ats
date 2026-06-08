'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { DataTable, EmptyState } from '../../../../components';
import { formatDate, formatRelativeTime, getInitials, getAvatarColor } from '../../../../lib/format-utils';
import type { UserListItem } from '../../../../lib/trpc-types';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  platform_owner: { bg: 'bg-purple-100', text: 'text-purple-700' },
  super_admin: { bg: 'bg-red-100', text: 'text-red-700' },
  hr_admin: { bg: 'bg-blue-100', text: 'text-blue-700' },
  recruiter: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  leader: { bg: 'bg-amber-100', text: 'text-amber-700' },
  employee: { bg: 'bg-gray-100', text: 'text-gray-500' },
};

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
  const { t } = useI18n();
  const router = useRouter();

  const columns = [
    { key: 'user', label: t.users.colUser },
    { key: 'email', label: t.users.colEmail },
    { key: 'org', label: t.users.colOrganization },
    { key: 'role', label: t.users.colRole },
    { key: 'status', label: t.users.colStatus },
    { key: 'lastLogin', label: t.users.colLastLogin },
    { key: 'created', label: t.users.colCreated },
    { key: 'actions', label: t.users.colActions },
  ];

  const emptyIcon = (
    <svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      empty={<EmptyState icon={emptyIcon} message={t.users.noUsersFound} description={t.users.adjustFilters} />}
      pagination={{ page, limit, total, onPageChange }}
    >
      {users.map((user) => {
        const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Sin nombre';
        const initials = getInitials(fullName);
        const roleSlug = user.isPlatformOwner ? 'platform_owner' : user.userRoles?.[0]?.role?.slug || 'employee';
        const roleColor = ROLE_COLORS[roleSlug] || ROLE_COLORS.employee;
        const avatarBg = user.isActive ? getAvatarColor(fullName) : 'bg-gray-400';

        return (
          <tr key={user.id} className="hover:bg-[#FAFAFA] border-b border-[#F3F3F3]">
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-[10px] font-bold`}>{initials}</div>
                <span className={`text-[13px] font-medium text-[#1F114C] ${!user.isActive ? 'opacity-60' : ''}`}>{fullName}</span>
              </div>
            </td>
            <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>{user.email}</td>
            <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
              {user.isPlatformOwner ? t.users.platform : user.organization?.name || '-'}
            </td>
            <td className="px-4 py-2.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleColor.bg} ${roleColor.text}`}>{roleSlug}</span>
            </td>
            <td className="px-4 py-2.5">
              <span className={`flex items-center gap-1.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
                <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                {user.isActive ? t.users.statusActive : t.users.statusInactive}
              </span>
            </td>
            <td className={`px-4 py-2.5 text-[12px] ${user.isActive ? 'text-[#585858]' : 'text-[#8B8B8B]'}`}>
              {formatRelativeTime(user.lastLoginAt)}
            </td>
            <td className="px-4 py-2.5 text-[12px] text-[#8B8B8B]">{formatDate(user.createdAt)}</td>
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (user.organizationId) router.push(`/platform/organizations/${user.organizationId}?tab=users`);
                  }}
                  className="px-2 py-1 text-[10px] text-[#1F114C] bg-[#F0EEF7] rounded font-medium hover:bg-[#E4E0F0]"
                >
                  {t.users.view}
                </button>
                <button
                  onClick={() => onEditRole(user)}
                  className="px-2 py-1 text-[10px] text-[#585858] bg-[#F3F3F3] rounded font-medium hover:bg-[#E8E8E8]"
                >
                  {t.common.edit}
                </button>
                {!user.isPlatformOwner && user.isActive && (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/impersonate/start', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ userId: user.id }),
                          });
                          if (!res.ok) throw new Error();
                          // Hard navigation so the server layout + tRPC context re-resolve as the target.
                          window.location.href = '/dashboard';
                        } catch {
                          toast(t.users.impersonateError, { type: 'error' });
                        }
                      }}
                      className="px-2 py-1 text-[10px] text-amber-600 bg-amber-50 rounded font-medium hover:bg-amber-100"
                    >
                      {t.users.impersonate}
                    </button>
                    <button
                      onClick={() => onDeactivate(user)}
                      className="px-2 py-1 text-[10px] text-[#DD0C15] bg-red-50 rounded font-medium hover:bg-red-100"
                    >
                      {t.users.deactivate}
                    </button>
                  </>
                )}
                {!user.isPlatformOwner && !user.isActive && (
                  <button
                    onClick={() => onActivate(user)}
                    className="px-2 py-1 text-[10px] text-green-600 bg-green-50 rounded font-medium hover:bg-green-100"
                  >
                    {t.users.activate}
                  </button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
