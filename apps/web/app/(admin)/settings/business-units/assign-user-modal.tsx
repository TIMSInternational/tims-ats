'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Modal, UserPicker } from '../../../../components';

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
  });

  return (
    <Modal
      title={t.units.assignUser}
      description={t.units.pickUser}
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
        disabled={assign.isPending}
        onSelect={(userId) => assign.mutate({ userId, businessUnitId })}
        searchPlaceholder={t.units.searchUser}
        loadingLabel={t.units.loadingUsers}
        emptyLabel={t.units.noUsers}
        ariaLabel={t.units.assignUser}
      />
      {/* Translated copy only, inside the open dialog: the server's own text never reaches the screen. */}
      {assign.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
          {t.units.errorGeneric}
        </p>
      )}
    </Modal>
  );
}
