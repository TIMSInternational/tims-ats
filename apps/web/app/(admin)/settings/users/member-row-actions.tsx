'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components/modal';
import { memberRoleOptions } from '../../../../lib/member-admin';
import type { AssignableStaffRole } from '@tims/shared';

const SECONDARY_BTN =
  'h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F7F7F7] transition';

// "Cambiar rol" / "Desactivar" on a member row (company-admin access-3 / ideal-78). Both open a dialog
// first; the server applies the same rules again (user.assignRole / user.deactivate).
export function MemberRowActions({
  member,
  currentRole,
  actorRoles,
  canChangeRole,
  canDeactivate,
}: {
  member: { id: string; name: string };
  currentRole: string | null;
  actorRoles: readonly string[];
  canChangeRole: boolean;
  canDeactivate: boolean;
}) {
  const { t } = useI18n();
  const m = t.teamSettings;
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<'role' | 'deactivate' | null>(null);
  const [selectedRole, setSelectedRole] = useState(currentRole ?? '');
  const options = memberRoleOptions(actorRoles, t.roles, currentRole);
  const close = () => setDialog(null);

  const changeRole = trpc.user.assignRole.useMutation({
    onSuccess: () => {
      toast(m.roleChanged, { type: 'success' });
      close();
      void utils.user.list.invalidate();
    },
    onError: (err) => toast(err.message || m.memberActionError, { type: 'error' }),
  });
  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => {
      toast(m.deactivated, { type: 'success' });
      close();
      void utils.user.list.invalidate();
    },
    onError: (err) => toast(err.message || m.memberActionError, { type: 'error' }),
  });

  const roleFieldId = `member-role-${member.id}`;

  return (
    <div className="flex justify-end gap-2">
      {canChangeRole && (
        <button
          type="button"
          onClick={() => {
            setSelectedRole(currentRole ?? '');
            setDialog('role');
          }}
          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-[#1F114C] border border-[#EDEDED] hover:bg-[#F7F7F7] transition"
        >
          {m.changeRole}
        </button>
      )}
      {canDeactivate && (
        <button
          type="button"
          onClick={() => setDialog('deactivate')}
          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-[#DD0C15] border border-red-200 hover:bg-red-50 transition"
        >
          {m.deactivate}
        </button>
      )}

      {dialog === 'role' && (
        <Modal title={m.changeRoleTitle.replace('{name}', member.name)} onClose={close} maxWidth="max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedRole && selectedRole !== currentRole)
                changeRole.mutate({ userId: member.id, roleSlug: selectedRole as AssignableStaffRole });
            }}
          >
            <label htmlFor={roleFieldId} className="block text-[12px] font-medium text-[#585858] mb-1.5">
              {m.roleLabel}
            </label>
            <select
              id={roleFieldId}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              aria-describedby={`${roleFieldId}-hint`}
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] bg-white text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            >
              {!currentRole && <option value="">{m.rolePlaceholder}</option>}
              {options.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.label}
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="mt-2 text-[12px] text-[#585858]">
                {m.roleDescriptions[selectedRole as keyof typeof m.roleDescriptions] ?? ''}
              </p>
            )}
            <p id={`${roleFieldId}-hint`} className="mt-2 text-[11px] text-[#8B8B8B]">
              {m.changeRoleHint}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={close} className={SECONDARY_BTN}>
                {m.cancel}
              </button>
              <button
                type="submit"
                disabled={changeRole.isPending || !selectedRole || selectedRole === currentRole}
                className="h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {changeRole.isPending ? t.common.saving : m.changeRoleSubmit}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'deactivate' && (
        <Modal title={m.deactivateTitle.replace('{name}', member.name)} onClose={close} maxWidth="max-w-md">
          <p className="text-sm text-[#585858]">{m.deactivateMessage}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={close} className={SECONDARY_BTN}>
              {m.cancel}
            </button>
            <button
              type="button"
              onClick={() => deactivate.mutate({ userId: member.id })}
              disabled={deactivate.isPending}
              className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {m.deactivateConfirm}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
