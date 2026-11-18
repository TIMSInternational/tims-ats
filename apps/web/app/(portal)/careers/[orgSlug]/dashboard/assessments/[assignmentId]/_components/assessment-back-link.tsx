'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../../../../lib/i18n';

// The way out of the player: a static bar above the content (never a floating chip over it, layout.md › Guides and
// safe areas), so it can't cover the page's message on a phone.
export function AssessmentBackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  return (
    <div className="flex h-14 items-center border-b border-border bg-white px-4">
      <Link
        href={`/careers/${orgSlug}/dashboard`}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-body font-medium text-secondary transition-colors hover:text-brand"
      >
        <svg
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
        {t.assessmentPlayer.backToDashboard}
      </Link>
    </div>
  );
}
