'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal, UserPicker } from '../../../../components';

interface AssignBuddyModalProps {
  planId: string;
  hireId: string;
  hireName: string;
  currentBuddyId: string | null;
  onClose: () => void;
}

/**
 * B-08: plans created at hire have no buddy, and nothing in the app could set one. Picking a person
 * saves it through onboarding.updatePlan (which re-checks scope, org membership and that the buddy is
 * not the hire). The buddy then sees the plan and can complete the buddy-owned tasks.
 */
export function AssignBuddyModal({ planId, hireId, hireName, currentBuddyId, onClose }: AssignBuddyModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const assign = trpc.onboarding.updatePlan.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.onboarding.list.invalidate(), utils.onboarding.getById.invalidate()]);
      toast(t.onboarding.buddyAssigned, { type: 'success' });
      onClose();
    },
    onError: (error) => toast(error.message, { type: 'error' }),
  });

  return (
    <Modal title={t.onboarding.assignBuddyTitle.replace('{name}', hireName)} onClose={onClose}>
      <p className="mb-3 text-[12px] text-[#585858]">{t.onboarding.assignBuddyDesc.replace('{name}', hireName)}</p>
      <UserPicker
        purpose="colleague"
        excludeIds={currentBuddyId ? [hireId, currentBuddyId] : [hireId]}
        onSelect={(userId) => assign.mutate({ id: planId, buddyId: userId })}
        disabled={assign.isPending}
        searchPlaceholder={t.committee.searchUser}
        loadingLabel={t.committee.loadingUsers}
        emptyLabel={t.committee.noUsers}
      />
    </Modal>
  );
}
