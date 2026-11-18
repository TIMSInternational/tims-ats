'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { Modal, UserPicker } from '../../../components';
import { PersonField } from '../people/performance/person-field';
import { ModalActions } from '../people/performance/modal-actions';
import type { PickedUser } from '../../../components/user-picker';

interface EnrollModalProps {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
}

export function EnrollModal({ courseId, courseTitle, onClose }: EnrollModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [employee, setEmployee] = useState<PickedUser | null>(null);

  const submit = trpc.learning.enrollUser.useMutation({
    onSuccess: () => {
      utils.learning.listCourses.invalidate();
      utils.learning.getDashboardKpis.invalidate();
      toast(t.learning.enrollSuccess, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit = !!employee && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit || !employee) return;
    submit.mutate({ userId: employee.id, courseId });
  };

  return (
    <Modal
      title={t.learning.enrollTitle}
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onSubmit={onSubmit}
          submitLabel={t.learning.enrollAction}
          isComplete={!!employee}
          isPending={submit.isPending}
          hint={t.learning.enrollHint}
        />
      }
    >
      <div className="space-y-4">
        {/* Course (read-only): a caption and value, not a label for a control. */}
        <div>
          <p className="mb-1.5 text-body font-medium text-primary">{t.learning.courseLabel}</p>
          <p className="rounded-lg bg-surface px-3 py-2.5 text-body text-primary">{courseTitle}</p>
        </div>

        <PersonField
          label={t.learning.employeeLabel}
          value={employee}
          onChange={setEmployee}
          disabled={submit.isPending}
          required
        >
          {(inputId) => (
            <UserPicker
              purpose="learning_enrollee"
              inputId={inputId}
              onSelect={(_userId, user) => setEmployee(user)}
              disabled={submit.isPending}
              searchPlaceholder={t.committee.searchUser}
              loadingLabel={t.committee.loadingUsers}
              emptyLabel={t.committee.noUsers}
            />
          )}
        </PersonField>
      </div>
    </Modal>
  );
}
