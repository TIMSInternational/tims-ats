'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { alertCls, inputCls, labelCls, primaryBtn, secondaryBtn } from './units-styles';

const NAME_MAX = 120;

type TeamFormModalProps =
  | { team: OrgTeam; businessUnitId?: never; onClose: () => void }
  | {
      team?: never;
      businessUnitId: string;
      onClose: () => void;
    };

/** Create a team inside a business unit, or rename an existing team (C# org structure). */
export function TeamFormModal({ team, businessUnitId, onClose }: TeamFormModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [name, setName] = useState(team?.name ?? '');

  const handlers = {
    onSuccess: () => {
      toast(team ? t.units.teamUpdated : t.units.teamCreated, { type: 'success' });
      onClose();
    },
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  };
  const create = useOrgStructureMutation('createTeam', handlers);
  const update = useOrgStructureMutation('updateTeam', handlers);
  const active = team ? update : create;
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !active.isPending;

  const submit = () => {
    if (!canSubmit) return;
    if (team) update.mutate({ id: team.id, name: trimmed });
    else if (businessUnitId) create.mutate({ businessUnitId, name: trimmed });
  };

  return (
    <Modal title={team ? t.units.editTeam : t.units.newTeam} onClose={onClose}>
      <label htmlFor="team-name" className={labelCls}>
        {t.units.nameLabel}
      </label>
      <input
        id="team-name"
        value={name}
        maxLength={NAME_MAX}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
      />
      {!team && <p className="text-[11px] text-[#8B8B8B] mt-2">{t.units.newTeamHint}</p>}
      {active.error && (
        <p role="alert" className={`${alertCls} mt-3`}>
          {errorMessage(active.error)}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          {t.units.cancel}
        </button>
        <button type="button" onClick={submit} disabled={!canSubmit} className={primaryBtn}>
          {active.isPending ? t.units.saving : t.units.save}
        </button>
      </div>
    </Modal>
  );
}
