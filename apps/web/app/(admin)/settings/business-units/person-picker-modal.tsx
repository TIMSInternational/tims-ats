'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, Modal, UserPicker } from '../../../../components';

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
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.units.cancel}
        </Button>
      }
    >
      <UserPicker
        purpose="org_structure_member"
        excludeIds={excludeIds}
        disabled={isPending}
        onSelect={(userId) => onPick(userId)}
        searchPlaceholder={t.units.searchUser}
        loadingLabel={t.units.loadingUsers}
        emptyLabel={t.units.noUsers}
        ariaLabel={title}
      />
      {errorMessage && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
          {errorMessage}
        </p>
      )}
    </Modal>
  );
}
