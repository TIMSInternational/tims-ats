'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n/index';

interface HireConfirmationModalProps {
  candidateName: string;
  initialJobTitle: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (jobTitle: string) => void;
}

export function HireConfirmationModal({ candidateName, initialJobTitle, isPending, onClose, onConfirm }: HireConfirmationModalProps) {
  const { t } = useI18n();
  const [jobTitle, setJobTitle] = useState(initialJobTitle);
  const normalizedJobTitle = jobTitle.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isPending) onClose();
    }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="hire-confirmation-title"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedJobTitle && !isPending) onConfirm(normalizedJobTitle);
        }}
      >
        <h2 id="hire-confirmation-title" className="text-lg font-semibold text-[#1F114C]">{t.offers.confirmHiringTitle}</h2>
        <p className="mt-2 text-sm text-[#585858]">{candidateName}</p>
        <p className="mt-3 text-sm text-[#585858]">{t.offers.confirmHiringDescription}</p>
        <label htmlFor="hire-job-title" className="mt-5 block text-sm font-medium text-[#1F114C]">{t.offers.hireJobTitle}</label>
        <input
          id="hire-job-title"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
          maxLength={200}
          required
          className="mt-1 w-full rounded-lg border border-[#D9D9D9] px-3 py-2 text-sm text-[#333] focus:border-[#5C4B99] focus:outline-none"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-[#D9D9D9] px-4 py-2 text-sm text-[#333] disabled:opacity-50">
            {t.common.cancel}
          </button>
          <button type="submit" disabled={!normalizedJobTitle || isPending} className="rounded-lg bg-[#DD0C15] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isPending ? t.offers.authorizingHiring : t.offers.confirmHiring}
          </button>
        </div>
      </form>
    </div>
  );
}
