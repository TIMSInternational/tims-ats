'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, TextInput } from '../../../../components';
import { useOrgStructureMutation, type OrgTeam } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';

const NAME_MAX = 120;
const FORM_ID = 'team-form';

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
    // Project rule: every mutation toasts its failure; the dialog keeps its inline copy too.
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  };
  const create = useOrgStructureMutation('createTeam', handlers);
  const update = useOrgStructureMutation('updateTeam', handlers);
  const active = team ? update : create;
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !active.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (team) update.mutate({ id: team.id, name: trimmed });
    else if (businessUnitId) create.mutate({ businessUnitId, name: trimmed });
  };

  return (
    <Modal
      title={team ? t.units.editTeam : t.units.newTeam}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.units.cancel}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={!canSubmit && !active.isPending}
            loading={active.isPending}
            loadingLabel={t.units.saving}
          >
            {team ? t.units.saveChanges : t.units.createTeam}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-3">
        <Field id="team-name" label={t.units.nameLabel} help={team ? undefined : t.units.newTeamHint}>
          <TextInput value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {active.error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
            {errorMessage(active.error)}
          </p>
        )}
      </form>
    </Modal>
  );
}
