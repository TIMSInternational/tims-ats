'use client';

import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { getInitials, getAvatarColor, formatDate, Skeleton } from '../../org-utils';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: 'bg-purple-100', text: 'text-purple-700' },
  hr_admin: { bg: 'bg-blue-100', text: 'text-blue-700' },
  recruiter: { bg: 'bg-teal-100', text: 'text-teal-700' },
  leader: { bg: 'bg-amber-100', text: 'text-amber-700' },
  employee: { bg: 'bg-gray-100', text: 'text-gray-600' },
  platform_owner: { bg: 'bg-rose-100', text: 'text-rose-700' },
};

function formatLastLogin(date: string | Date | null | undefined): string {
  if (!date) return 'Nunca';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Hace ${days}d`;
  return formatDate(date);
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[#F6F6F6] animate-pulse">
      <td className="px-4 py-3"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full bg-gray-200" /><div className="h-3.5 w-28 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-3"><div className="h-3 w-36 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-10 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-6 w-16 bg-gray-100 rounded" /></td>
    </tr>
  );
}

export function UsersSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const { data, isLoading } = trpc.platform.getOrgUsers.useQuery({ organizationId });

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#333]">Usuarios ({data?.total ?? 0})</h3>
        <button className="h-8 px-3 rounded-lg bg-[#DD0C15] text-xs text-white font-medium hover:bg-[#c40b13] transition flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          Invitar Usuario
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#EDEDED]">
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Usuario</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Email</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Rol</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Cargo</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.common.status}</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Ultimo Login</th>
              <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F3F3]">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <svg className="w-10 h-10 mx-auto mb-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                  <p className="text-sm text-[#8B8B8B]">No hay usuarios en esta organizacion</p>
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Sin nombre';
                const initials = getInitials(fullName);
                const roleSlug = user.isPlatformOwner ? 'platform_owner' : (user as any).userRoles?.[0]?.role?.slug || 'employee';
                const roleColor = ROLE_COLORS[roleSlug] || ROLE_COLORS.employee;
                const avatarBg = user.isActive ? getAvatarColor(fullName) : 'bg-gray-400';

                return (
                  <tr key={user.id} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-[10px] font-bold`}>{initials}</div>
                        <span className={`text-[13px] font-medium text-[#1F114C] ${!user.isActive ? 'opacity-60' : ''}`}>{fullName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[#585858]">{user.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleColor.bg} ${roleColor.text}`}>{roleSlug}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[#585858]">{user.jobTitle || '\u2014'}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-[12px] text-[#585858]">
                        <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {user.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[#8B8B8B]">{formatLastLogin(user.lastLoginAt)}</td>
                    <td className="px-4 py-2.5">
                      {user.isActive ? (
                        <button className="px-2 py-1 text-[10px] text-[#DD0C15] bg-red-50 rounded font-medium hover:bg-red-100 transition">Desactivar</button>
                      ) : (
                        <button className="px-2 py-1 text-[10px] text-green-600 bg-green-50 rounded font-medium hover:bg-green-100 transition">Activar</button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
