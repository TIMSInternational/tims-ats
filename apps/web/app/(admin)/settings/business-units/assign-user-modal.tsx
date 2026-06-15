'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';

interface AssignUserModalProps {
  businessUnitId: string;
  excludeIds: string[];
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignUserModal({ businessUnitId, excludeIds, onClose, onAssigned }: AssignUserModalProps) {
  const { t } = useI18n();

  const assign = trpc.organization.assignUserToUnit.useMutation({
    onSuccess: () => {
      toast(t.units.assigned, { type: 'success' });
      onAssigned();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  return (
    <Modal title={t.units.assignUser} onClose={onClose}>
      <p className="text-[12px] text-[#8B8B8B] mb-3">{t.units.pickUser}</p>
      <UserPicker
        excludeIds={excludeIds}
        disabled={assign.isPending}
        onSelect={(userId) => assign.mutate({ userId, businessUnitId })}
        searchPlaceholder={t.units.searchUser}
        loadingLabel={t.units.loadingUsers}
        emptyLabel={t.units.noUsers}
      />
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
        >
          {t.units.cancel}
        </button>
      </div>
    </Modal>
  );
}
