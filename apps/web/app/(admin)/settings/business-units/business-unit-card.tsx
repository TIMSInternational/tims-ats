'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import {
  useOrgStructureMutation,
  type OrgBusinessUnit,
  type OrgTeam,
} from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { TeamRow } from './team-row';
import type { OrgStructureAbilities } from './use-org-abilities';
import { alertCls, dangerSmallBtn, smallBtn } from './units-styles';

export interface BusinessUnitCardActions {
  onEdit: () => void;
  onNewTeam: () => void;
  onAddAssignee: () => void;
  onRenameTeam: (team: OrgTeam) => void;
  onSetLeader: (team: OrgTeam) => void;
  onManageMembers: (team: OrgTeam) => void;
}

interface BusinessUnitCardProps {
  unit: OrgBusinessUnit;
  abilities: OrgStructureAbilities;
  actions: BusinessUnitCardActions;
}

/** A business unit with its unit assignees (unit-scope approvers) and teams. */
export function BusinessUnitCard({ unit, abilities, actions }: BusinessUnitCardProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [failure, setFailure] = useState<string | null>(null);
  const report = (error: unknown) => {
    const message = errorMessage(error);
    setFailure(message);
    toast(message, { type: 'error' });
  };

  const toggle = useOrgStructureMutation('updateBusinessUnit', {
    onSuccess: () => {
      setFailure(null);
      toast(t.units.unitUpdated, { type: 'success' });
    },
    onError: report,
  });
  const removeAssignee = useOrgStructureMutation('removeUnitAssignee', {
    onSuccess: () => {
      setFailure(null);
      toast(t.units.removed, { type: 'success' });
    },
    onError: report,
  });

  return (
    <section
      aria-label={unit.name}
      className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${unit.isActive ? '' : 'opacity-70'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[#1F114C]">
            {unit.name}
            {unit.code && <span className="ml-2 text-[11px] font-normal text-[#8B8B8B]">{unit.code}</span>}
            {!unit.isActive && <span className="ml-2 text-[10px] font-normal text-[#8B8B8B]">{t.units.inactive}</span>}
          </h3>
          <p className="text-[11px] text-[#8B8B8B]">
            {unit.teamCount} {t.units.teamsCount}
          </p>
        </div>
        {abilities.updateStructure && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={actions.onEdit} className={smallBtn}>
              {t.units.rename}
            </button>
            <button
              type="button"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ id: unit.id, isActive: !unit.isActive })}
              className={unit.isActive ? dangerSmallBtn : smallBtn}
            >
              {unit.isActive ? t.units.deactivate : t.units.reactivate}
            </button>
          </div>
        )}
      </div>

      {failure && (
        <p role="alert" className={`${alertCls} mb-3`}>
          {failure}
        </p>
      )}

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[12px] font-semibold text-[#585858]">{t.units.assigneesTitle}</h4>
          {abilities.assignPeople && (
            <button type="button" onClick={actions.onAddAssignee} className={smallBtn}>
              {t.units.addAssignee}
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#8B8B8B] mb-2">{t.units.assigneesHint}</p>
        {unit.unitAssignees.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.units.noMembers}</p>
        ) : (
          <ul className="divide-y divide-[#F6F6F6]">
            {unit.unitAssignees.map((person) => (
              <li key={person.userId} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[#333] truncate">{person.fullName}</p>
                  <p className="text-[11px] text-[#8B8B8B] truncate">{person.email}</p>
                </div>
                {abilities.unassignPeople && (
                  <button
                    type="button"
                    disabled={removeAssignee.isPending}
                    onClick={() => {
                      if (window.confirm(t.units.removeConfirm)) {
                        removeAssignee.mutate({ businessUnitId: unit.id, userId: person.userId });
                      }
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
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[12px] font-semibold text-[#585858]">{t.units.teamsTitle}</h4>
          {abilities.createStructure && unit.isActive && (
            <button type="button" onClick={actions.onNewTeam} className={smallBtn}>
              {t.units.newTeam}
            </button>
          )}
        </div>
        {unit.teams.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.units.noTeams}</p>
        ) : (
          <ul className="divide-y divide-[#F6F6F6]">
            {unit.teams.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                abilities={abilities}
                onRename={() => actions.onRenameTeam(team)}
                onSetLeader={() => actions.onSetLeader(team)}
                onManageMembers={() => actions.onManageMembers(team)}
                onFailure={setFailure}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
