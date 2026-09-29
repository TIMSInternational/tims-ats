'use client';

import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { dangerSmallBtn, smallBtn } from './units-styles';

interface TeamRowProps {
  team: OrgTeam;
  canUpdate: boolean;
  onRename: () => void;
  onSetLeader: () => void;
  onManageMembers: () => void;
  /** Reports a failed write so the unit card can show it inline. */
  onFailure: (message: string) => void;
}

/** One team inside a business unit card: leader, member count, and its management actions. */
export function TeamRow({ team, canUpdate, onRename, onSetLeader, onManageMembers, onFailure }: TeamRowProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const update = useOrgStructureMutation('updateTeam', {
    onSuccess: () => toast(t.units.teamUpdated, { type: 'success' }),
    onError: (error: unknown) => {
      const message = errorMessage(error);
      toast(message, { type: 'error' });
      onFailure(message);
    },
  });

  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${team.isActive ? '' : 'opacity-60'}`}>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-[#333]">
          {team.name}
          {!team.isActive && <span className="ml-2 text-[10px] text-[#8B8B8B]">{t.units.inactive}</span>}
        </p>
        <p className="text-[11px] text-[#8B8B8B]">
          {t.units.leader}: {team.leader ? team.leader.fullName : t.units.noLeader} · {team.members.length}{' '}
          {t.units.membersCount}
        </p>
      </div>
      {canUpdate && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onManageMembers} className={smallBtn}>
            {t.units.members}
          </button>
          <button type="button" onClick={onSetLeader} disabled={update.isPending} className={smallBtn}>
            {team.leader ? t.units.changeLeader : t.units.setLeader}
          </button>
          {team.leader && (
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: team.id, leaderUserId: null })}
              className={smallBtn}
            >
              {t.units.clearLeader}
            </button>
          )}
          <button type="button" onClick={onRename} className={smallBtn}>
            {t.units.rename}
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: team.id, isActive: !team.isActive })}
            className={team.isActive ? dangerSmallBtn : smallBtn}
          >
            {team.isActive ? t.units.deactivate : t.units.reactivate}
          </button>
        </div>
      )}
    </li>
  );
}
