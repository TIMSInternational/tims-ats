'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { I18nProvider, useI18n } from '../lib/i18n';
import { careersNotFoundTarget } from '../lib/careers-not-found';

function NotFoundContent() {
  const { t } = useI18n();
  const careers = careersNotFoundTarget(usePathname());

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F6F6F6] px-6 text-center">
      <p className="text-[72px] font-bold leading-none text-[#1F114C]">404</p>
      <h1 className="mt-4 text-[22px] font-semibold text-[#1F114C]">{t.notFound.title}</h1>
      <p className="mt-2 max-w-sm text-[14px] text-[#585858]">{careers ? t.notFound.careersMessage : t.notFound.message}</p>
      {careers ? (
        careers.href && (
          <Link
            href={careers.href}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#DD0C15] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[#c00b13]"
          >
            {t.notFound.backToVacancies}
          </Link>
        )
      ) : (
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#DD0C15] px-5 text-[13px] font-medium text-white transition-colors hover:bg-[#c00b13]"
        >
          {t.notFound.backToDashboard}
        </Link>
      )}
    </div>
  );
}

// Next.js App Router special file — renders for ANY unmatched route across the
// whole app (authenticated admin routes AND public routes like a broken
// careers-portal link), so it runs in place of whichever nested layout would
// have matched and cannot rely on the (admin) shell's I18nProvider being
// mounted. Mirrors the standalone-segment pattern already used by
// mfa/layout.tsx and (portal)/layout.tsx: bring its own I18nProvider instead
// of depending on one higher in the tree.
export default function NotFound() {
  return (
    <I18nProvider>
      <NotFoundContent />
    </I18nProvider>
  );
}
