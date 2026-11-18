'use client';

import { useI18n } from '../../../lib/i18n';
import { PageHeader } from '../../../components';
import { MyOnboardingView } from './my-onboarding-view';

// Personal "Mi onboarding" page for the new hire. HR keeps /people/onboarding;
// this page only reads the caller's own plan through the own-scoped
// onboarding.list / onboarding.getById procedures.
export default function MyOnboardingPage() {
  const { t } = useI18n();

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader title={t.myOnboarding.pageTitle} description={t.myOnboarding.pageDescription} />

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:space-y-6 md:p-5">
        <MyOnboardingView />
      </div>
    </div>
  );
}
