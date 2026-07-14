'use client';

import { useI18n } from '../../../lib/i18n';
import { MyTasksSection } from './my-tasks-section';
import { MyReportSection } from './my-report-section';

export default function My360Page() {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-7 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[#8B8B8B]">{t.my360.breadcrumb}</span>
          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[#333] font-semibold">{t.my360.pageTitle}</span>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-8">
        <MyTasksSection />
        <MyReportSection />
      </div>
    </div>
  );
}
