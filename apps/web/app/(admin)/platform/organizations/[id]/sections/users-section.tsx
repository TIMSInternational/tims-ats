'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { getInitials, getAvatarColor, formatDate } from '../../../../../../lib/format-utils';
import { Skeleton, Modal } from '../../../../../../components';
import { InviteUserModal } from '../../../invitations/invite-user-modal';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: 'bg-purple-100', text: 'text-purple-700' },
  hr_admin: { bg: 'bg-blue-100', text: 'text-blue-700' },
  hrbp: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  recruiter: { bg: 'bg-teal-100', text: 'text-teal-700' },
  leader: { bg: 'bg-amber-100', text: 'text-amber-700' },
  committee: { bg: 'bg-orange-100', text: 'text-orange-700' },
  employee: { bg: 'bg-gray-100', text: 'text-gray-600' },
  platform_owner: { bg: 'bg-rose-100', text: 'text-rose-700' },
};

const ASSIGNABLE_ROLES = [
  { slug: 'super_admin', label: 'Super Admin' },
  { slug: 'hr_admin', label: 'HR Admin' },
  { slug: 'hrbp', label: 'HRBP' },
  { slug: 'recruiter', label: 'Recruiter' },
  { slug: 'leader', label: 'Leader' },
  { slug: 'committee', label: 'Committee' },
  { slug: 'employee', label: 'Employee' },
];

function RoleSelector({ userId, organizationId, currentRole }: { userId: string; organizationId: string; currentRole: string }) {
  const utils = trpc.useUtils();
  const changeRole = trpc.platform.changeOrgUserRole.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast('Rol actualizado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al cambiar rol', { type: 'error' }); },
  });

  return (
    <select
      value={currentRole}
      disabled={changeRole.isPending}
      onChange={(e) => {
        if (e.target.value !== currentRole) {
          changeRole.mutate({ userId, organizationId, roleSlug: e.target.value });
        }
      }}
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-[#EDEDED] bg-white text-[#333] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30 disabled:opacity-50 cursor-pointer"
    >
      {ASSIGNABLE_ROLES.map((r) => (
        <option key={r.slug} value={r.slug}>{r.label}</option>
      ))}
    </select>
  );
}

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

export function UsersSection({ organizationId, organizationName }: { organizationId: string; organizationName?: string }) {
  const { t } = useI18n();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; name: string } | null>(null);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.platform.getOrgUsers.useQuery({ organizationId });

  const deactivateUser = trpc.platform.deactivateOrgUser.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast('Usuario desactivado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al desactivar usuario', { type: 'error' }); },
  });

  const activateUser = trpc.platform.activateOrgUser.useMutation({
    onSuccess: () => {
      utils.platform.getOrgUsers.invalidate({ organizationId });
      toast('Usuario activado', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al activar usuario', { type: 'error' }); },
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#333]">Usuarios ({data?.total ?? 0})</h3>
        <button
          onClick={() => setShowInviteModal(true)}
          className="h-8 px-3 rounded-lg bg-[#DD0C15] text-xs text-white font-medium hover:bg-[#c40b13] transition flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          Invitar Usuario
        </button>
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

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left">
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
                      {user.isPlatformOwner ? (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleColor.bg} ${roleColor.text}`}>platform_owner</span>
                      ) : (
                        <RoleSelector userId={user.id} organizationId={organizationId} currentRole={roleSlug} />
                      )}
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
                        <button
                          disabled={deactivateUser.isPending}
                          onClick={() => setDeactivateTarget({ id: user.id, name: fullName })}
                          className="px-2 py-1 text-[10px] text-[#DD0C15] bg-red-50 rounded font-medium hover:bg-red-100 transition disabled:opacity-50"
                        >
                          Desactivar
                        </button>
                      ) : (
                        <button
                          disabled={activateUser.isPending}
                          onClick={() => {
                            activateUser.mutate({ userId: user.id, organizationId });
                          }}
                          className="px-2 py-1 text-[10px] text-green-600 bg-green-50 rounded font-medium hover:bg-green-100 transition disabled:opacity-50"
                        >
                          Activar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table></div>
      </div>
      {deactivateTarget && (
        <Modal title={`Desactivar a ${deactivateTarget.name}?`} onClose={() => setDeactivateTarget(null)} maxWidth="max-w-sm">
          <p className="text-sm text-[#585858] mb-4">El usuario perdera acceso a la plataforma.</p>
          <div className="flex gap-3">
            <button onClick={() => setDeactivateTarget(null)} className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
            <button onClick={() => { deactivateUser.mutate({ userId: deactivateTarget.id, organizationId }); setDeactivateTarget(null); }} className="flex-1 h-9 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-[#c40b13] transition">Desactivar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
