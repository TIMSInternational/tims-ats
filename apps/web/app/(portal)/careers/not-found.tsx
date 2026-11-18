'use client';

import { useI18n } from '../../../lib/i18n';
import { isCandidate404LinksEnabled } from '../../../lib/careers-not-found';
import { CandidateNotFoundActions } from '../../../components/candidate-not-found-actions';

// 404 for /careers/<slug> when no active organization owns the slug (careers/[orgSlug]/layout.tsx
// calls notFound()). Candidate-facing: there is no board to send them back to, and the staff
// dashboard the root 404 offers is the wrong door for a candidate — so this page has no board CTA.
// With NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED on, it offers "go back" when the tab has a previous page.
export default function CareersNotFound() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <p className="font-display text-[72px] font-bold leading-none text-brand" aria-hidden="true">404</p>
      <h1 className="mt-4 font-display text-title font-semibold text-brand">{t.notFound.title}</h1>
      <p className="mt-2 max-w-sm text-base text-secondary sm:text-subheading">{t.notFound.careersPortalNotFound}</p>
      {isCandidate404LinksEnabled() && <CandidateNotFoundActions boardHref={null} />}
    </main>
  );
}
