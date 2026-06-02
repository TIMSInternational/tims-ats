'use client';

import { useState } from 'react';
import { Modal } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import type { UserListItem } from '../../../../lib/trpc-types';

const ASSIGNABLE_ROLES = [
  { slug: 'super_admin', label: 'Super Admin' },
  { slug: 'hr_admin', label: 'HR Admin' },
  { slug: 'recruiter', label: 'Recruiter' },
  { slug: 'leader', label: 'Leader' },
  { slug: 'employee', label: 'Employee' },
];

interface RoleChangeModalProps {
  user: UserListItem;
  onConfirm: (roleSlug: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export function RoleChangeModal({ user, onConfirm, onClose, isPending }: RoleChangeModalProps) {
  const { t } = useI18n();
  const currentRole = user.isPlatformOwner ? 'platform_owner' : user.userRoles?.[0]?.role?.slug || 'employee';
  const [selected, setSelected] = useState(currentRole);
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

  return (
    <Modal title={`${t.users.role} — ${fullName}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[#8B8B8B]">{user.email}</p>

        {user.isPlatformOwner ? (
          <div className="p-4 rounded-lg bg-purple-50 border border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              <span className="text-sm font-semibold text-purple-700">Platform Owner</span>
            </div>
            <p className="text-xs text-purple-600">Los Platform Owners tienen acceso total a la plataforma. Su rol no puede ser modificado desde aqui.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {ASSIGNABLE_ROLES.map((role) => {
              const isCurrent = role.slug === currentRole;
              const isSelected = role.slug === selected;
              return (
                <button
                  key={role.slug}
                  onClick={() => setSelected(role.slug)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition text-left ${
                    isSelected ? 'border-[#1F114C] bg-[#1F114C]/5' : 'border-[#EDEDED] hover:border-[#8B8B8B]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-3 h-3 rounded-full border-2 ${isSelected ? 'border-[#1F114C] bg-[#1F114C]' : 'border-[#EDEDED]'}`} />
                    <span className="text-sm font-medium text-[#333]">{role.label}</span>
                  </div>
                  {isCurrent && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#1F114C]/10 text-[#1F114C] font-bold">Actual</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition">
            {user.isPlatformOwner ? t.common.close : t.common.cancel}
          </button>
          {!user.isPlatformOwner && (
            <button
              onClick={() => onConfirm(selected)}
              disabled={isPending || selected === currentRole}
              className="h-9 px-4 rounded-lg bg-[#1F114C] text-sm text-white font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
            >
              {isPending ? t.common.saving : t.common.confirm}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
