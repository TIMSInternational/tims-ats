'use client';

import { useCallback, useState } from 'react';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { roleLabel } from '../../../../../lib/role-labels';

interface HireConfirmationModalProps {
  candidateName: string;
  accessEmail: string;
  startDate: Date | string | null;
  initialJobTitle: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (jobTitle: string) => void;
}

// "Confirmar ingreso" (B-31): the shared Modal (focus trap, Escape, dialog semantics) instead of a
// hand-rolled overlay, and the facts the hire creates — start date, the email that receives access, the role.
export function HireConfirmationModal({
  candidateName,
  accessEmail,
  startDate,
  initialJobTitle,
  isPending,
  onClose,
  onConfirm,
}: HireConfirmationModalProps) {
  const { t } = useI18n();
  const [jobTitle, setJobTitle] = useState(initialJobTitle);
  const normalizedJobTitle = jobTitle.trim();
  // Stable across keystrokes: Modal re-runs its focus effect when onClose changes identity, which would pull
  // focus out of the job-title field after every character (Codex review; same fix as the apply modal).
  const close = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);

  return (
    <Modal title={t.offers.confirmHiringTitle} onClose={close} maxWidth="max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedJobTitle && !isPending) onConfirm(normalizedJobTitle);
        }}
      >
        <p className="text-sm font-medium text-[#1F114C]">{candidateName}</p>
        <p className="mt-3 text-sm text-[#585858]">{t.offers.confirmHiringDescription}</p>
        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 rounded-lg bg-[#F6F6F6] p-3 text-[13px]">
          <dt className="text-[#8B8B8B]">{t.offers.hireStartDate}</dt>
          <dd className="text-[#333]">{formatDate(startDate)}</dd>
          <dt className="text-[#8B8B8B]">{t.offers.hireAccessEmail}</dt>
          <dd className="break-all text-[#333]">{accessEmail}</dd>
          <dt className="text-[#8B8B8B]">{t.offers.hireRole}</dt>
          <dd className="text-[#333]">{roleLabel(t.roles, 'employee')}</dd>
        </dl>
        <label htmlFor="hire-job-title" className="mt-5 block text-sm font-medium text-[#1F114C]">
          {t.offers.hireJobTitle}
        </label>
        <input
          id="hire-job-title"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
          maxLength={200}
          required
          className="mt-1 w-full rounded-lg border border-[#D9D9D9] px-3 py-2 text-sm text-[#333] focus:border-[#5C4B99] focus:outline-none"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={isPending}
            className="rounded-lg border border-[#D9D9D9] px-4 py-2 text-sm text-[#333] disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!normalizedJobTitle || isPending}
            className="rounded-lg bg-[#DD0C15] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? t.offers.authorizingHiring : t.offers.confirmHiring}
          </button>
        </div>
      </form>
    </Modal>
  );
}
