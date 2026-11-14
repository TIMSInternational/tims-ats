'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button, IconButton, Modal, UserPicker } from '../../../../../components';
import type { PickedUser } from '../../../../../components/user-picker';
import { isAssignablePeopleViaCSharp } from '../../../../../lib/platform-api/assignable-people';

interface SubmitApprovalModalProps {
  vacancyId: string;
  onConfirm: (approverIds: string[]) => void;
  onClose: () => void;
  isPending: boolean;
  /** Server message from the last failed submit (e.g. an approver outside the vacancy's scope). */
  errorMessage?: string | null;
}

export function SubmitApprovalModal({
  vacancyId,
  onConfirm,
  onClose,
  isPending,
  errorMessage,
}: SubmitApprovalModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<PickedUser[]>([]);

  const addApprover = (userId: string, user: PickedUser) => {
    if (selected.some((u) => u.id === userId)) return;
    if (selected.length >= 10) return;
    setSelected((prev) => [...prev, user]);
  };

  const removeApprover = (userId: string) => {
    setSelected((prev) => prev.filter((u) => u.id !== userId));
  };

  return (
    <Modal
      title={t.vacancies.submitForApproval}
      description={t.vacancies.selectApprovers}
      onClose={onClose}
      dirty={selected.length > 0 && !isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => onConfirm(selected.map((u) => u.id))}
            disabled={selected.length === 0}
            loading={isPending}
            loadingLabel={t.vacancies.submitting}
          >
            {t.vacancies.submitForApproval}
          </Button>
        </>
      }
    >
      {selected.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {selected.map((u) => {
            const name = `${u.firstName} ${u.lastName}`;
            return (
              <li
                key={u.id}
                className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-0.5 text-callout text-primary"
              >
                {name}
                <IconButton
                  label={`${t.vacancies.removeApprover} ${name}`}
                  size="sm"
                  onClick={() => removeApprover(u.id)}
                >
                  <svg
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      <UserPicker
        purpose="vacancy_approver"
        vacancyId={vacancyId}
        emptyHint={isAssignablePeopleViaCSharp() ? t.vacancies.noEligibleApprovers : undefined}
        excludeIds={selected.map((u) => u.id)}
        onSelect={addApprover}
        disabled={isPending}
        searchPlaceholder={t.vacancies.searchApprovers}
        loadingLabel={t.vacancies.loadingApprovers}
        emptyLabel={t.vacancies.noApproversFound}
        ariaLabel={t.vacancies.searchApprovers}
      />

      {errorMessage && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-callout text-danger"
        >
          {errorMessage}
        </p>
      )}
    </Modal>
  );
}
