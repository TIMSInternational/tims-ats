'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, ErrorState, Skeleton } from '../../../../components';
import { useOrgStructure, type OrgBusinessUnit, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { AssignPersonModal, type AssignPersonTarget } from './assign-person-modal';
import { BusinessUnitCard } from './business-unit-card';
import { BusinessUnitFormModal } from './business-unit-form-modal';
import { TeamFormModal } from './team-form-modal';
import { TeamMembersModal } from './team-members-modal';
import { UnitsTopBar } from './units-top-bar';
import { useOrgStructureAbilities } from './use-org-abilities';
import { UserBusinessUnitModal } from './user-business-unit-modal';
import { inputCls, primaryBtn, secondaryBtn } from './units-styles';

type Dialog =
  | { kind: 'unit'; unit?: OrgBusinessUnit }
  | { kind: 'team'; businessUnitId: string }
  | { kind: 'renameTeam'; team: OrgTeam }
  | { kind: 'members'; teamId: string }
  | { kind: 'person'; target: AssignPersonTarget }
  | { kind: 'primaryUnit' };

/** Admin screen for business units, teams, leaders, members and unit assignees (C# org structure). */
export function OrgStructureManager() {
  const { t } = useI18n();
  const structure = useOrgStructure();
  const [companyId, setCompanyId] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const abilities = useOrgStructureAbilities();
  const canCreate = abilities.createStructure;
  const close = () => setDialog(null);

  const companies = structure.data?.companies ?? [];
  const allUnits = structure.data?.businessUnits ?? [];
  const units = companyId ? allUnits.filter((u) => u.companyId === companyId) : allUnits;
  const allTeams = allUnits.flatMap((u) => u.teams);
  // Members dialog reads the live team from the refetched tree, so adds/removes show immediately.
  const membersTeam = dialog?.kind === 'members' ? allTeams.find((team) => team.id === dialog.teamId) : undefined;

  const topActions = (
    <>
      {abilities.setHomeUnit && (
        <button type="button" onClick={() => setDialog({ kind: 'primaryUnit' })} className={secondaryBtn}>
          {t.units.primaryUnitTitle}
        </button>
      )}
      {canCreate && (
        <button type="button" onClick={() => setDialog({ kind: 'unit' })} className={primaryBtn}>
          {t.units.newUnit}
        </button>
      )}
    </>
  );

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <UnitsTopBar actions={topActions} />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <p className="text-[12px] text-[#585858]">{t.units.managementIntro}</p>
        {companies.length > 1 && (
          <select
            aria-label={t.units.selectCompany}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className={`${inputCls} max-w-xs`}
          >
            <option value="">{t.units.allCompanies}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {structure.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : structure.isError ? (
          <ErrorState onRetry={() => structure.refetch()} message={structure.error.message} />
        ) : units.length === 0 ? (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <EmptyState
              icon={
                <svg
                  className="w-8 h-8 text-[#B8B8B8]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M3.75 21h16.5M4.5 3h15v18h-15V3Zm4.5 4.5h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6h1.5m-1.5 3h1.5m-1.5 3h1.5" />
                </svg>
              }
              message={t.units.emptyTitle}
              description={t.units.emptyDescription}
              action={canCreate ? { label: t.units.newUnit, onClick: () => setDialog({ kind: 'unit' }) } : undefined}
            />
          </div>
        ) : (
          units.map((unit) => (
            <BusinessUnitCard
              key={unit.id}
              unit={unit}
              abilities={abilities}
              actions={{
                onEdit: () => setDialog({ kind: 'unit', unit }),
                onNewTeam: () => setDialog({ kind: 'team', businessUnitId: unit.id }),
                onAddAssignee: () =>
                  setDialog({
                    kind: 'person',
                    target: {
                      kind: 'unitAssignee',
                      businessUnitId: unit.id,
                      excludeIds: unit.unitAssignees.map((p) => p.userId),
                    },
                  }),
                onRenameTeam: (team) => setDialog({ kind: 'renameTeam', team }),
                onSetLeader: (team) =>
                  setDialog({
                    kind: 'person',
                    target: {
                      kind: 'teamLeader',
                      teamId: team.id,
                      excludeIds: team.leader ? [team.leader.userId] : [],
                    },
                  }),
                onManageMembers: (team) => setDialog({ kind: 'members', teamId: team.id }),
              }}
            />
          ))
        )}
      </div>

      {dialog?.kind === 'unit' && <BusinessUnitFormModal unit={dialog.unit} companies={companies} onClose={close} />}
      {dialog?.kind === 'team' && <TeamFormModal businessUnitId={dialog.businessUnitId} onClose={close} />}
      {dialog?.kind === 'renameTeam' && <TeamFormModal team={dialog.team} onClose={close} />}
      {membersTeam && <TeamMembersModal team={membersTeam} abilities={abilities} onClose={close} />}
      {dialog?.kind === 'person' && <AssignPersonModal target={dialog.target} onClose={close} />}
      {dialog?.kind === 'primaryUnit' && (
        <UserBusinessUnitModal
          units={allUnits.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name }))}
          onClose={close}
        />
      )}
    </div>
  );
}
