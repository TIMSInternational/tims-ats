'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { Button, Menu, StatusBadge, type MenuEntry } from '../../../../components';
import { useOrgErrorMessage } from './use-org-error-message';
import type { OrgStructureAbilities } from './use-org-abilities';

interface TeamRowProps {
  team: OrgTeam;
  abilities: OrgStructureAbilities;
  onRename: () => void;
  onSetLeader: () => void;
  onManageMembers: () => void;
  /** Reports a failed write so the unit card can show it inline. */
  onFailure: (message: string) => void;
}

/**
 * One team inside a business unit card: leader, member count, one visible action ("Miembros") and the rest in
 * a "Más acciones" menu, so a row never shows five equal buttons (toolbars.md › Item groupings).
 */
export function TeamRow({ team, abilities, onRename, onSetLeader, onManageMembers, onFailure }: TeamRowProps) {
  const { t, locale } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const update = useOrgStructureMutation('updateTeam', {
    onSuccess: () => toast(t.units.teamUpdated, { type: 'success' }),
    // Project rule: every mutation toasts its failure; the card keeps its inline copy too.
    onError: (error: unknown) => {
      const message = errorMessage(error);
      toast(message, { type: 'error' });
      onFailure(message);
    },
  });

  const items: MenuEntry[] = [];
  if (abilities.setLeader) {
    items.push({
      key: 'leader',
      label: team.leader ? t.units.changeLeaderEllipsis : t.units.setLeaderEllipsis,
      onSelect: onSetLeader,
      disabled: update.isPending,
    });
    if (team.leader)
      items.push({
        key: 'clearLeader',
        label: t.units.clearLeader,
        onSelect: () => update.mutate({ id: team.id, leaderUserId: null }),
        disabled: update.isPending,
      });
  }
  if (abilities.updateStructure) {
    items.push({ key: 'rename', label: t.units.renameEllipsis, onSelect: onRename });
    items.push({ key: 'sep', type: 'separator' });
    items.push({
      key: 'toggle',
      label: team.isActive ? t.units.deactivateTeam : t.units.reactivateTeam,
      destructive: team.isActive,
      disabled: update.isPending,
      onSelect: () => update.mutate({ id: team.id, isActive: !team.isActive }),
    });
  }

  const members = pluralize(
    team.members.length,
    { one: t.units.membersCountOne, other: t.units.membersCountOther },
    locale,
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-body font-medium text-primary">
          {team.name}
          {!team.isActive && <StatusBadge tone="neutral">{t.units.inactiveTeam}</StatusBadge>}
        </p>
        <p className="text-callout text-secondary">
          {team.leader ? formatMessage(t.units.leaderNamed, { name: team.leader.fullName }) : t.units.noLeaderAssigned}{' '}
          · {members}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {(abilities.assignPeople || abilities.unassignPeople) && (
          <Button variant="secondary" size="sm" onClick={onManageMembers}>
            {t.units.members}
          </Button>
        )}
        {items.length > 0 && <Menu items={items} label={formatMessage(t.units.teamActions, { name: team.name })} />}
      </div>
    </li>
  );
}
