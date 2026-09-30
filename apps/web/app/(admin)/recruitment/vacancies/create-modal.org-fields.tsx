'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useVacancyOrgOptions } from '../../../../lib/platform-api/org-structure-options';
import { inputCls, labelCls } from './create-modal.helpers';

interface VacancyOrgFieldsProps {
  businessUnitId: string | null;
  teamId: string | null;
  hiringManager: PickedUser | null;
  onBusinessUnitChange: (id: string | null) => void;
  onTeamChange: (id: string | null) => void;
  onHiringManagerChange: (user: PickedUser | null) => void;
}

const hintCls = 'text-[11px] text-[#8B8B8B] mt-1';

/**
 * Business unit, team and hiring manager for a new vacancy — the anchors leader (team) and unit-scoped
 * approvals are evaluated against. When the caller cannot read the org structure the selects are
 * hidden with a hint instead of failing the whole wizard.
 */
export function VacancyOrgFields({
  businessUnitId,
  teamId,
  hiringManager,
  onBusinessUnitChange,
  onTeamChange,
  onHiringManagerChange,
}: VacancyOrgFieldsProps) {
  const { t } = useI18n();
  const options = useVacancyOrgOptions(businessUnitId);
  const [pickingManager, setPickingManager] = useState(false);
  const selectedTeam = options.teams.find((team) => team.id === teamId);

  return (
    <div className="border-t border-[#EDEDED] pt-4 space-y-3">
      <p className="text-[13px] font-medium text-[#1F114C]">{t.vacancies.orgPlacementTitle}</p>

      {options.failure === 'forbidden' ? (
        <p className={hintCls}>{t.vacancies.orgPlacementForbidden}</p>
      ) : options.failure === 'unavailable' ? (
        <p role="alert" className="text-[11px] text-[#DD0C15]">
          {t.vacancies.orgPlacementLoadError}
        </p>
      ) : options.isLoading ? (
        <p className={hintCls}>{t.vacancies.orgPlacementLoading}</p>
      ) : options.units.length === 0 ? (
        <p className={hintCls}>{t.vacancies.orgPlacementNoUnits}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="vacancy-business-unit" className={labelCls}>
              {t.vacancies.businessUnitField}
            </label>
            <select
              id="vacancy-business-unit"
              value={businessUnitId ?? ''}
              onChange={(e) => {
                onBusinessUnitChange(e.target.value || null);
                onTeamChange(null);
              }}
              className={`${inputCls} bg-white`}
            >
              <option value="">{t.vacancies.noBusinessUnit}</option>
              {options.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="vacancy-team" className={labelCls}>
              {t.vacancies.teamField}
            </label>
            <select
              id="vacancy-team"
              value={teamId ?? ''}
              onChange={(e) => onTeamChange(e.target.value || null)}
              disabled={!businessUnitId}
              className={`${inputCls} bg-white disabled:bg-[#F6F6F6] disabled:text-[#B8B8B8]`}
            >
              <option value="">{businessUnitId ? t.vacancies.noTeam : t.vacancies.pickUnitFirst}</option>
              {options.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {selectedTeam && !selectedTeam.hasLeader && <p className={hintCls}>{t.vacancies.teamWithoutLeader}</p>}
          </div>
        </div>
      )}

      <div>
        <p className={labelCls}>{t.vacancies.hiringManager}</p>
        {hiringManager ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[#EDEDED] px-3 h-10">
            <span className="text-sm text-[#333] truncate">
              {hiringManager.firstName} {hiringManager.lastName}
            </span>
            <button
              type="button"
              onClick={() => onHiringManagerChange(null)}
              className="text-[12px] text-[#DD0C15] font-medium"
            >
              {t.vacancies.clearHiringManager}
            </button>
          </div>
        ) : pickingManager ? (
          <UserPicker
            // Not vacancy_approver: a hiring manager need not hold vacancy:approve, and that picker is gated on
            // vacancy:update. vacancy_assignee lists any active member, like vacancy.create accepts.
            purpose="vacancy_assignee"
            onSelect={(_id, user) => {
              onHiringManagerChange(user);
              setPickingManager(false);
            }}
            searchPlaceholder={t.vacancies.searchApprovers}
            loadingLabel={t.vacancies.loadingApprovers}
            emptyLabel={t.vacancies.noApproversFound}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPickingManager(true)}
            className="h-9 px-3 rounded-lg border border-[#EDEDED] text-[12px] text-[#1F114C] font-medium hover:bg-[#F6F6F6] transition"
          >
            {t.vacancies.pickHiringManager}
          </button>
        )}
        <p className={hintCls}>{t.vacancies.hiringManagerHint}</p>
      </div>
    </div>
  );
}
