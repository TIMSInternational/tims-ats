'use client';

import { useI18n } from '../../../../lib/i18n';
import { Modal, UserPicker } from '../../../../components';
import { alertCls, secondaryBtn } from './units-styles';

interface PersonPickerModalProps {
  title: string;
  description: string;
  excludeIds?: string[];
  isPending: boolean;
  errorMessage: string | null;
  onPick: (userId: string) => void;
  onClose: () => void;
}

/** Modal around the org user picker (tRPC user.list — admins managing structure hold user:read). */
export function PersonPickerModal({
  title,
  description,
  excludeIds,
  isPending,
  errorMessage,
  onPick,
  onClose,
}: PersonPickerModalProps) {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-[12px] text-[#8B8B8B] mb-3">{description}</p>
      <UserPicker
        purpose="org_structure_member"
        excludeIds={excludeIds}
        disabled={isPending}
        onSelect={(userId) => onPick(userId)}
        searchPlaceholder={t.units.searchUser}
        loadingLabel={t.units.loadingUsers}
        emptyLabel={t.units.noUsers}
      />
      {errorMessage && (
        <p role="alert" className={`${alertCls} mt-3`}>
          {errorMessage}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          {t.units.cancel}
        </button>
      </div>
    </Modal>
  );
}
