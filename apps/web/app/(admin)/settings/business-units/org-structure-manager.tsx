'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '../../../../components';
import { useOrgStructure, type OrgBusinessUnit, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { AssignPersonModal, type AssignPersonTarget } from './assign-person-modal';
import { BusinessUnitCard } from './business-unit-card';
import { BusinessUnitFormModal } from './business-unit-form-modal';
import { TeamFormModal } from './team-form-modal';
import { TeamMembersModal } from './team-members-modal';
import { useOrgStructureAbilities } from './use-org-abilities';
import { UserBusinessUnitModal } from './user-business-unit-modal';

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
        <Button variant="secondary" onClick={() => setDialog({ kind: 'primaryUnit' })}>
          {t.units.primaryUnitAction}
        </Button>
      )}
      {canCreate && <Button onClick={() => setDialog({ kind: 'unit' })}>{t.units.newUnit}</Button>}
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.units.title} description={t.units.managementIntro} actions={topActions} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {companies.length > 1 && (
          <Select
            aria-label={t.units.selectCompany}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="max-w-xs"
          >
            <option value="">{t.units.allCompanies}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}

        {structure.isLoading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : structure.isError ? (
          <ErrorState onRetry={() => structure.refetch()} message={t.units.loadError} error={structure.error} />
        ) : units.length === 0 ? (
          <div className="rounded-xl bg-white shadow-card">
            <EmptyState
              icon={
                <svg
                  className="size-8 text-muted"
                  aria-hidden="true"
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
