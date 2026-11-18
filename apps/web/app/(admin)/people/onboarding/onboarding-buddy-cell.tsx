'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button } from '../../../../components';
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
        <p className="flex flex-wrap items-center gap-x-1 text-callout text-secondary">
          {t.onboarding.buddyPrefix} {buddy.firstName} {buddy.lastName.charAt(0)}.
          {canAssign && (
            <Button
              variant="tertiary"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => setOpen(true)}
              aria-label={`${t.onboarding.changeBuddy}: ${t.onboarding.assignBuddyTitle.replace('{name}', hireName)}`}
            >
              {t.onboarding.changeBuddy}
            </Button>
          )}
        </p>
      ) : canAssign ? (
        <Button
          variant="tertiary"
          size="sm"
          className="-ml-1.5 h-6 px-1.5"
          onClick={() => setOpen(true)}
          aria-label={`${t.onboarding.assignBuddy}: ${hireName}`}
        >
          {t.onboarding.assignBuddy}
        </Button>
      ) : (
        <p className="text-callout text-secondary">{t.onboarding.noBuddyAssigned}</p>
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
