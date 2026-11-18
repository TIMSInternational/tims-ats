'use client';

import { Modal } from '../../../../../../components';
import { Button } from '../../../../../../components/button';
import { useI18n } from '../../../../../../lib/i18n';

interface ApplySuccessProps {
  vacancyTitle: string;
  companyName: string;
  /** The candidate portal (its dashboard sends a signed-out candidate to the portal login). */
  portalHref: string;
  onClose: () => void;
}

// Confirmation after a submitted application: what happens next, and where to follow it — the
// candidate portal, which nothing else on the careers pages pointed to.
export function ApplySuccess({ vacancyTitle, companyName, portalHref, onClose }: ApplySuccessProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <Modal
      title={p.applicationSentTitle}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {p.understood}
          </Button>
          <Button href={portalHref}>{p.trackApplications}</Button>
        </>
      }
    >
      <div className="flex flex-col items-center pt-2 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-success-bg" aria-hidden="true">
          <svg className="size-7 text-success" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" focusable="false">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="mb-1 text-base text-secondary sm:text-subheading">
          {p.applicationReceivedPrefix} <span className="font-medium text-primary">{vacancyTitle}</span>{' '}
          {p.applicationReceivedSuffix}
        </p>
        <div className="mt-4 w-full rounded-lg bg-surface p-4 text-left">
          <h3 className="mb-2 text-subheading font-semibold text-brand">{p.nextStepsTitle}</h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-base text-secondary sm:text-body">
            <li>
              {p.teamWillReviewPrefix} {companyName} {p.teamWillReviewSuffix}
            </li>
            <li>{p.nextStepInterview}</li>
            <li>{p.nextStepTrack}</li>
          </ol>
        </div>
      </div>
    </Modal>
  );
}
