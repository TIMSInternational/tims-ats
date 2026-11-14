'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import {
  useOrgStructureMutation,
  type OrgBusinessUnit,
  type OrgTeam,
  type OrgPerson,
} from '../../../../lib/platform-api/org-structure';
import { Button, ConfirmDialog, Menu, StatusBadge } from '../../../../components';
import { useOrgErrorMessage } from './use-org-error-message';
import { TeamRow } from './team-row';
import type { OrgStructureAbilities } from './use-org-abilities';

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

const SECTION_TITLE = 'text-callout font-semibold text-secondary';
const PLUS = (
  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

/** A business unit with its unit assignees (unit-scope approvers) and teams. */
export function BusinessUnitCard({ unit, abilities, actions }: BusinessUnitCardProps) {
  const { t, locale } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OrgPerson | null>(null);
  // The failure is shown inline on the card (role=alert); no duplicate toast.
  const report = (error: unknown) => setFailure(errorMessage(error));

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
      setRemoving(null);
      toast(t.units.removed, { type: 'success' });
    },
    onError: (error: unknown) => {
      setRemoving(null);
      report(error);
    },
  });

  const teams = pluralize(unit.teamCount, { one: t.units.teamsCountOne, other: t.units.teamsCountOther }, locale);

  return (
    <section
      aria-label={unit.name}
      className={`rounded-xl p-5 shadow-card ${unit.isActive ? 'bg-white' : 'border border-border bg-surface'}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-heading font-semibold text-brand">
            {unit.name}
            {unit.code && <span className="text-callout font-normal text-secondary">{unit.code}</span>}
            {!unit.isActive && <StatusBadge tone="neutral">{t.units.inactive}</StatusBadge>}
          </h2>
          <p className="text-callout text-secondary">{teams}</p>
        </div>
        {abilities.updateStructure && (
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={actions.onEdit}>
              {t.units.editEllipsis}
            </Button>
            <Menu
              label={formatMessage(t.units.unitActions, { name: unit.name })}
              items={[
                {
                  key: 'toggle',
                  label: unit.isActive ? t.units.deactivateUnit : t.units.reactivateUnit,
                  destructive: unit.isActive,
                  disabled: toggle.isPending,
                  onSelect: () => toggle.mutate({ id: unit.id, isActive: !unit.isActive }),
                },
              ]}
            />
          </div>
        )}
      </div>

      {failure && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
          {failure}
        </p>
      )}

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className={SECTION_TITLE}>{t.units.assigneesTitle}</h3>
          {abilities.assignPeople && (
            <Button variant="tertiary" size="sm" icon={PLUS} onClick={actions.onAddAssignee}>
              {t.units.addAssignee}
            </Button>
          )}
        </div>
        <p className="mb-2 text-callout text-secondary">{t.units.assigneesHint}</p>
        {unit.unitAssignees.length === 0 ? (
          <p className="text-body text-secondary">{t.units.noAssignees}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {unit.unitAssignees.map((person) => (
              <li key={person.userId} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-primary">{person.fullName}</p>
                  <p className="truncate text-callout text-secondary">{person.email}</p>
                </div>
                {abilities.unassignPeople && (
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={removeAssignee.isPending}
                    onClick={() => setRemoving(person)}
                  >
                    {t.units.remove}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className={SECTION_TITLE}>{t.units.teamsTitle}</h3>
          {abilities.createStructure && unit.isActive && (
            <Button variant="tertiary" size="sm" icon={PLUS} onClick={actions.onNewTeam}>
              {t.units.newTeam}
            </Button>
          )}
        </div>
        {unit.teams.length === 0 ? (
          <p className="text-body text-secondary">{t.units.noTeams}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
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

      {removing && (
        <ConfirmDialog
          title={formatMessage(t.units.removeAssigneeTitle, { name: removing.fullName })}
          description={t.units.removeAssigneeBody}
          confirmLabel={t.units.removeFromUnit}
          confirmingLabel={t.units.removing}
          destructive
          loading={removeAssignee.isPending}
          onConfirm={() => removeAssignee.mutate({ businessUnitId: unit.id, userId: removing.userId })}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
