'use client';

import { useCallback, useState } from 'react';
import { Modal } from '../../../../../components';
import { Button } from '../../../../../components/button';
import { FIELD_LABEL_CLASSES, inputClasses } from '../../../../../components/field-styles';
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
    <Modal
      title={t.offers.confirmHiringTitle}
      description={t.offers.confirmHiringDescription}
      onClose={close}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={isPending}>
            {t.common.cancel}
          </Button>
          {/* A positive step: the navy primary, not red (buttons.md › Role). */}
          <Button type="submit" form="hire-confirmation-form" disabled={!normalizedJobTitle} loading={isPending} loadingLabel={t.offers.authorizingHiring}>
            {t.offers.confirmHiring}
          </Button>
        </>
      }
    >
      <form
        id="hire-confirmation-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedJobTitle && !isPending) onConfirm(normalizedJobTitle);
        }}
      >
        <p className="text-subheading font-semibold text-brand">{candidateName}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-surface p-3 text-body">
          <dt className="text-secondary">{t.offers.hireStartDate}</dt>
          <dd className="text-primary">{formatDate(startDate)}</dd>
          <dt className="text-secondary">{t.offers.hireAccessEmail}</dt>
          <dd className="break-all text-primary">{accessEmail}</dd>
          <dt className="text-secondary">{t.offers.hireRole}</dt>
          <dd className="text-primary">{roleLabel(t.roles, 'employee')}</dd>
        </dl>
        <label htmlFor="hire-job-title" className={`${FIELD_LABEL_CLASSES} mt-5`}>
          {t.offers.hireJobTitle}
        </label>
        <input
          id="hire-job-title"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
          maxLength={200}
          required
          className={inputClasses()}
        />
      </form>
    </Modal>
  );
}
