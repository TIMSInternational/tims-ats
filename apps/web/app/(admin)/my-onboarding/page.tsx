'use client';

import { useI18n } from '../../../lib/i18n';
import { MyOnboardingView } from './my-onboarding-view';

// Personal "Mi Onboarding" page for the new hire. HR keeps /people/onboarding;
// this page only reads the caller's own plan through the own-scoped
// onboarding.list / onboarding.getById procedures.
export default function MyOnboardingPage() {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-7 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[#8B8B8B]">{t.myOnboarding.breadcrumb}</span>
          <svg
            className="w-3.5 h-3.5 text-[#8B8B8B]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[#333] font-semibold">{t.myOnboarding.pageTitle}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <MyOnboardingView />
      </div>
    </div>
  );
}
