'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, Select, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useOrgStructureMutation } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';

const FORM_ID = 'primary-unit-form';

interface UserBusinessUnitModalProps {
  units: Array<{ id: string; name: string }>;
  onClose: () => void;
}

/** Sets (or clears) a user's primary business unit — users.business_unit_id (C# org structure). */
export function UserBusinessUnitModal({ units, onClose }: UserBusinessUnitModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [user, setUser] = useState<PickedUser | null>(null);
  const [unitId, setUnitId] = useState('');

  // The failure shows inside the open dialog only (settings-15).
  const save = useOrgStructureMutation('setUserBusinessUnit', {
    onSuccess: () => {
      toast(t.units.primaryUnitSaved, { type: 'success' });
      onClose();
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || save.isPending) return;
    save.mutate({ userId: user.id, businessUnitId: unitId === '' ? null : unitId });
  };

  return (
    <Modal
      title={t.units.primaryUnitTitle}
      description={t.units.primaryUnitHint}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.units.cancel}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!user} loading={save.isPending} loadingLabel={t.units.saving}>
            {t.units.saveChanges}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        {user ? (
          <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border px-3">
            <span className="truncate text-body text-primary">
              {user.firstName} {user.lastName}
            </span>
            <Button variant="tertiary" size="sm" onClick={() => setUser(null)}>
              {t.units.change}
            </Button>
          </div>
        ) : (
          <UserPicker
            purpose="org_structure_member"
            onSelect={(_id, picked) => setUser(picked)}
            searchPlaceholder={t.units.searchUser}
            loadingLabel={t.units.loadingUsers}
            emptyLabel={t.units.noUsers}
            ariaLabel={t.units.searchUser}
          />
        )}
        <Field id="primary-unit" label={t.units.primaryUnitLabel}>
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{t.units.noPrimaryUnit}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        {save.error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
            {errorMessage(save.error)}
          </p>
        )}
      </form>
    </Modal>
  );
}
