'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { Button, Modal, StatusBadge, UserPicker } from '../../../../components';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import type { OrgStructureAbilities } from './use-org-abilities';

interface TeamMembersModalProps {
  team: OrgTeam;
  abilities: OrgStructureAbilities;
  onClose: () => void;
}

/** Lists a team's members and adds / removes them (C# org structure). */
export function TeamMembersModal({ team, abilities, onClose }: TeamMembersModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [adding, setAdding] = useState(false);
  // Removing asks inside the row (a second modal on top of this one would stack overlays).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const add = useOrgStructureMutation('addTeamMember', {
    onSuccess: () => {
      toast(t.units.memberAdded, { type: 'success' });
      setAdding(false);
    },
  });
  const remove = useOrgStructureMutation('removeTeamMember', {
    onSuccess: () => {
      setConfirmingId(null);
      toast(t.units.memberRemoved, { type: 'success' });
    },
  });
  const failed = add.error ?? remove.error;
  const busy = add.isPending || remove.isPending;

  return (
    <Modal
      title={`${t.units.membersOf} ${team.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.units.close}
        </Button>
      }
    >
      {team.members.length === 0 ? (
        <p className="py-4 text-center text-body text-secondary">{t.units.noTeamMembers}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border">
          {team.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              {confirmingId === m.userId ? (
                <>
                  <p className="min-w-0 text-body font-medium text-primary">
                    {formatMessage(t.units.removeMemberInline, { name: m.fullName })}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setConfirmingId(null)} disabled={busy}>
                      {t.units.cancel}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      loading={remove.isPending}
                      loadingLabel={t.units.removing}
                      onClick={() => remove.mutate({ teamId: team.id, userId: m.userId })}
                    >
                      {t.units.removeFromTeam}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-body font-medium text-primary">
                      <span className="truncate">{m.fullName}</span>
                      {m.role === 'lead' && <StatusBadge tone="brand">{t.units.roleLead}</StatusBadge>}
                    </p>
                    <p className="truncate text-callout text-secondary">{m.email}</p>
                  </div>
                  {abilities.unassignPeople && (
                    <Button variant="tertiary" size="sm" disabled={busy} onClick={() => setConfirmingId(m.userId)}>
                      {t.units.remove}
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {abilities.assignPeople && (
        <div className="mt-4">
          {adding ? (
            <UserPicker
              purpose="org_structure_member"
              excludeIds={team.members.map((m) => m.userId)}
              disabled={busy}
              onSelect={(userId) => add.mutate({ teamId: team.id, userId, role: 'member' })}
              searchPlaceholder={t.units.searchUser}
              loadingLabel={t.units.loadingUsers}
              emptyLabel={t.units.noUsers}
              ariaLabel={t.units.addMember}
            />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              {t.units.addMember}
            </Button>
          )}
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
          {errorMessage(failed)}
        </p>
      )}
    </Modal>
  );
}
