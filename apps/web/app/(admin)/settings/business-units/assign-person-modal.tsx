'use client';

import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { useOrgStructureMutation } from '../../../../lib/platform-api/org-structure';
import { PersonPickerModal } from './person-picker-modal';
import { useOrgErrorMessage } from './use-org-error-message';

export type AssignPersonTarget =
  | { kind: 'unitAssignee'; businessUnitId: string; excludeIds: string[] }
  | { kind: 'teamLeader'; teamId: string; excludeIds: string[] }
  | { kind: 'teamMember'; teamId: string; excludeIds: string[] };

interface AssignPersonModalProps {
  target: AssignPersonTarget;
  onClose: () => void;
}

/** Picks a user and writes one person relation: unit assignee, team leader or team member (C#). */
export function AssignPersonModal({ target, onClose }: AssignPersonModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const handlers = {
    onSuccess: () => {
      toast(t.units.saved, { type: 'success' });
      onClose();
    },
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  };
  const addAssignee = useOrgStructureMutation('addUnitAssignee', handlers);
  const setLeader = useOrgStructureMutation('updateTeam', handlers);
  const addMember = useOrgStructureMutation('addTeamMember', handlers);
  const active = target.kind === 'unitAssignee' ? addAssignee : target.kind === 'teamLeader' ? setLeader : addMember;

  const onPick = (userId: string) => {
    if (target.kind === 'unitAssignee') addAssignee.mutate({ businessUnitId: target.businessUnitId, userId });
    else if (target.kind === 'teamLeader') setLeader.mutate({ id: target.teamId, leaderUserId: userId });
    else addMember.mutate({ teamId: target.teamId, userId, role: 'member' });
  };

  const copy =
    target.kind === 'unitAssignee'
      ? { title: t.units.addAssignee, description: t.units.addAssigneeHint }
      : target.kind === 'teamLeader'
        ? { title: t.units.setLeader, description: t.units.setLeaderHint }
        : { title: t.units.addMember, description: t.units.addMemberHint };

  return (
    <PersonPickerModal
      title={copy.title}
      description={copy.description}
      excludeIds={target.excludeIds}
      isPending={active.isPending}
      errorMessage={active.error ? errorMessage(active.error) : null}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
