'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { alertCls, dangerSmallBtn, secondaryBtn, smallBtn } from './units-styles';

interface TeamMembersModalProps {
  team: OrgTeam;
  canUpdate: boolean;
  onClose: () => void;
}

/** Lists a team's members and adds / removes them (C# org structure). */
export function TeamMembersModal({ team, canUpdate, onClose }: TeamMembersModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [adding, setAdding] = useState(false);
  const onError = (error: unknown) => toast(errorMessage(error), { type: 'error' });

  const add = useOrgStructureMutation('addTeamMember', {
    onSuccess: () => {
      toast(t.units.memberAdded, { type: 'success' });
      setAdding(false);
    },
    onError,
  });
  const remove = useOrgStructureMutation('removeTeamMember', {
    onSuccess: () => toast(t.units.memberRemoved, { type: 'success' }),
    onError,
  });
  const failed = add.error ?? remove.error;
  const busy = add.isPending || remove.isPending;

  return (
    <Modal title={`${t.units.membersOf} ${team.name}`} onClose={onClose} maxWidth="max-w-xl">
      {team.members.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{t.units.noTeamMembers}</p>
      ) : (
        <ul className="divide-y divide-[#F6F6F6] border border-[#EDEDED] rounded-lg max-h-[280px] overflow-y-auto">
          {team.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#333] truncate">
                  {m.fullName}
                  {m.role === 'lead' && <span className="ml-2 text-[10px] text-[#8B8B8B]">{t.units.roleLead}</span>}
                </p>
                <p className="text-[11px] text-[#8B8B8B] truncate">{m.email}</p>
              </div>
              {canUpdate && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t.units.removeMemberConfirm))
                      remove.mutate({ teamId: team.id, userId: m.userId });
                  }}
                  className={dangerSmallBtn}
                >
                  {t.units.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpdate && (
        <div className="mt-4">
          {adding ? (
            <UserPicker
              excludeIds={team.members.map((m) => m.userId)}
              disabled={busy}
              onSelect={(userId) => add.mutate({ teamId: team.id, userId, role: 'member' })}
              searchPlaceholder={t.units.searchUser}
              loadingLabel={t.units.loadingUsers}
              emptyLabel={t.units.noUsers}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={smallBtn}>
              {t.units.addMember}
            </button>
          )}
        </div>
      )}

      {failed && (
        <p role="alert" className={`${alertCls} mt-3`}>
          {errorMessage(failed)}
        </p>
      )}
      <div className="flex justify-end mt-5">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          {t.units.close}
        </button>
      </div>
    </Modal>
  );
}
