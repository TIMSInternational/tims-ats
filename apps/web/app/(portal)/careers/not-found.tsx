'use client';

import { useI18n } from '../../../lib/i18n';

// 404 for /careers/<slug> when no active organization owns the slug (careers/[orgSlug]/layout.tsx
// calls notFound()). Candidate-facing: there is no board to send them back to, and the staff
// dashboard the root 404 offers is the wrong door for a candidate — so this page has no CTA.
export default function CareersNotFound() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F6F6F6] px-6 text-center">
      <p className="text-[72px] font-bold leading-none text-[#1F114C]">404</p>
      <h1 className="mt-4 text-[22px] font-semibold text-[#1F114C]">{t.notFound.title}</h1>
      <p className="mt-2 max-w-sm text-[14px] text-[#585858]">{t.notFound.careersPortalNotFound}</p>
    </main>
  );
}
