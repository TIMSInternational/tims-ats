'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useVacancyOrgOptions } from '../../../../lib/platform-api/org-structure-options';
import { hintCls, inputCls, labelCls } from './create-modal.helpers';

interface VacancyOrgFieldsProps {
  businessUnitId: string | null;
  teamId: string | null;
  hiringManager: PickedUser | null;
  onBusinessUnitChange: (id: string | null) => void;
  onTeamChange: (id: string | null) => void;
  onHiringManagerChange: (user: PickedUser | null) => void;
}

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
    <section aria-labelledby="vacancy-org-title" className="space-y-3 border-t border-border pt-4">
      <h3 id="vacancy-org-title" className="text-subheading font-semibold text-brand">
        {t.vacancies.orgPlacementTitle}
      </h3>

      {options.failure === 'forbidden' ? (
        <p className={hintCls}>{t.vacancies.orgPlacementForbidden}</p>
      ) : options.failure === 'unavailable' ? (
        <p role="alert" className="text-callout text-danger">
          {t.vacancies.orgPlacementLoadError}
        </p>
      ) : options.isLoading ? (
        <p className={hintCls}>{t.vacancies.orgPlacementLoading}</p>
      ) : options.units.length === 0 ? (
        <p className={hintCls}>{t.vacancies.orgPlacementNoUnits}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              className={`${inputCls} pr-8`}
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
              aria-describedby={selectedTeam && !selectedTeam.hasLeader ? 'vacancy-team-hint' : undefined}
              className={`${inputCls} pr-8`}
            >
              <option value="">{businessUnitId ? t.vacancies.noTeam : t.vacancies.pickUnitFirst}</option>
              {options.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {selectedTeam && !selectedTeam.hasLeader && (
              <p id="vacancy-team-hint" className={hintCls}>
                {t.vacancies.teamWithoutLeader}
              </p>
            )}
          </div>
        </div>
      )}

      <div>
        <p id="vacancy-hiring-manager-label" className={labelCls}>
          {t.vacancies.hiringManager}
        </p>
        {hiringManager ? (
          <div className="flex min-h-9 items-center justify-between gap-2 rounded-lg border border-field-border px-3">
            <span className="truncate text-body text-primary">
              {hiringManager.firstName} {hiringManager.lastName}
            </span>
            <Button variant="tertiary" size="sm" onClick={() => onHiringManagerChange(null)}>
              {t.vacancies.clearHiringManager}
            </Button>
          </div>
        ) : pickingManager ? (
          <UserPicker
            // Not vacancy_approver: a hiring manager need not hold vacancy:approve, and that picker is gated on
            // vacancy:update. vacancy_assignee lists any active member, like vacancy.create accepts.
            purpose="vacancy_assignee"
            ariaLabelledBy="vacancy-hiring-manager-label"
            onSelect={(_id, user) => {
              onHiringManagerChange(user);
              setPickingManager(false);
            }}
            searchPlaceholder={t.vacancies.searchApprovers}
            loadingLabel={t.vacancies.loadingApprovers}
            emptyLabel={t.vacancies.noApproversFound}
          />
        ) : (
          <Button
            variant="secondary"
            onClick={() => setPickingManager(true)}
            aria-describedby="vacancy-hiring-manager-hint"
          >
            {t.vacancies.pickHiringManager}
          </Button>
        )}
        <p id="vacancy-hiring-manager-hint" className={hintCls}>
          {t.vacancies.hiringManagerHint}
        </p>
      </div>
    </section>
  );
}
