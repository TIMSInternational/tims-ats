'use client';

import { usePathname } from 'next/navigation';
import { I18nProvider, useI18n } from '../lib/i18n';
import { careersNotFoundTarget } from '../lib/careers-not-found';
import { Button } from '../components/button';

function NotFoundContent() {
  const { t } = useI18n();
  const careers = careersNotFoundTarget(usePathname());

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center">
      <p aria-hidden="true" className="font-display text-7xl font-bold leading-none text-brand">
        404
      </p>
      <h1 className="mt-4 font-display text-display font-semibold text-brand">{t.notFound.title}</h1>
      <p className="mt-2 max-w-sm text-subheading text-secondary">
        {careers ? t.notFound.careersMessage : t.notFound.message}
      </p>
      {careers ? (
        careers.href && (
          <Button href={careers.href} size="lg" className="mt-6">
            {t.notFound.backToVacancies}
          </Button>
        )
      ) : (
        <Button href="/dashboard" size="lg" className="mt-6">
          {t.notFound.backToDashboard}
        </Button>
      )}
    </main>
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
