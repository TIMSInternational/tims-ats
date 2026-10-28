'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';
import { useOrgStructureMutation } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { alertCls, inputCls, labelCls, primaryBtn, secondaryBtn, smallBtn } from './units-styles';

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

  const save = useOrgStructureMutation('setUserBusinessUnit', {
    onSuccess: () => {
      toast(t.units.primaryUnitSaved, { type: 'success' });
      onClose();
    },
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  });

  return (
    <Modal title={t.units.primaryUnitTitle} onClose={onClose}>
      <p className="text-[12px] text-[#8B8B8B] mb-3">{t.units.primaryUnitHint}</p>
      {user ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#EDEDED] px-3 h-10 mb-3">
          <span className="text-[13px] text-[#333] truncate">
            {user.firstName} {user.lastName}
          </span>
          <button type="button" onClick={() => setUser(null)} className={smallBtn}>
            {t.units.change}
          </button>
        </div>
      ) : (
        <div className="mb-3">
          <UserPicker
            purpose="org_structure_member"
            onSelect={(_id, picked) => setUser(picked)}
            searchPlaceholder={t.units.searchUser}
            loadingLabel={t.units.loadingUsers}
            emptyLabel={t.units.noUsers}
          />
        </div>
      )}
      <label htmlFor="primary-unit" className={labelCls}>
        {t.units.primaryUnitLabel}
      </label>
      <select id="primary-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputCls}>
        <option value="">{t.units.noPrimaryUnit}</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      {save.error && (
        <p role="alert" className={`${alertCls} mt-3`}>
          {errorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          {t.units.cancel}
        </button>
        <button
          type="button"
          disabled={!user || save.isPending}
          onClick={() => user && save.mutate({ userId: user.id, businessUnitId: unitId === '' ? null : unitId })}
          className={primaryBtn}
        >
          {save.isPending ? t.units.saving : t.units.save}
        </button>
      </div>
    </Modal>
  );
}
