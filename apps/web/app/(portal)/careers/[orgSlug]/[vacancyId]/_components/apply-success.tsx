'use client';

import Link from 'next/link';
import { Modal } from '../../../../../../components';
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
    <Modal title="" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex flex-col items-center py-4 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
          <svg
            className="h-8 w-8 text-green-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mb-2 text-[18px] font-bold text-[#1F114C]">{p.applicationSentTitle}</h3>
        <p className="mb-1 text-[14px] text-[#585858]">
          {p.applicationReceivedPrefix} <span className="font-medium text-[#333]">{vacancyTitle}</span>{' '}
          {p.applicationReceivedSuffix}
        </p>
        <div className="mt-4 w-full rounded-lg bg-[#F6F6F6] p-4 text-left">
          <p className="mb-2 text-[13px] font-semibold text-[#1F114C]">{p.nextStepsTitle}</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[#585858]">
            <li>
              {p.teamWillReviewPrefix} {companyName} {p.teamWillReviewSuffix}
            </li>
            <li>{p.nextStepInterview}</li>
            <li>{p.nextStepTrack}</li>
          </ol>
        </div>
        <div className="mt-6 flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-[#EDEDED] px-6 text-[13px] font-medium text-[#585858] transition-colors hover:bg-[#F6F6F6]"
          >
            {p.understood}
          </button>
          <Link
            href={portalHref}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#1F114C] px-6 text-[13px] font-medium text-white transition-colors hover:bg-[#2a1a5c]"
          >
            {p.trackApplications}
          </Link>
        </div>
      </div>
    </Modal>
  );
}
