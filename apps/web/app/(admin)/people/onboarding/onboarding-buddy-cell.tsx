'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { AssignBuddyModal } from './assign-buddy-modal';

interface OnboardingBuddyCellProps {
  planId: string;
  hire: { id: string; firstName: string; lastName: string };
  buddy: { id: string; firstName: string; lastName: string } | null;
  /** onboarding:update — HR and the hiring leader; the picker modal only mounts when opened. */
  canAssign: boolean;
}

export function OnboardingBuddyCell({ planId, hire, buddy, canAssign }: OnboardingBuddyCellProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hireName = `${hire.firstName} ${hire.lastName}`;

  return (
    <>
      {buddy ? (
        <p className="text-[10px] text-[#8B8B8B]">
          {t.onboarding.buddyPrefix} {buddy.firstName} {buddy.lastName.charAt(0)}.
          {canAssign && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(true);
              }}
              className="ml-1.5 text-[#1F114C] underline hover:text-[#DD0C15] transition"
              aria-label={`${t.onboarding.changeBuddy}: ${t.onboarding.assignBuddyTitle.replace('{name}', hireName)}`}
            >
              {t.onboarding.changeBuddy}
            </button>
          )}
        </p>
      ) : canAssign ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          className="text-[10px] font-medium text-[#DD0C15] underline hover:text-[#c40b13] transition"
          aria-label={`${t.onboarding.assignBuddy}: ${hireName}`}
        >
          {t.onboarding.assignBuddy}
        </button>
      ) : (
        <p className="text-[10px] text-[#8B8B8B]">{t.onboarding.noBuddyAssigned}</p>
      )}
      {open && (
        <AssignBuddyModal
          planId={planId}
          hireId={hire.id}
          hireName={hireName}
          currentBuddyId={buddy?.id ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
