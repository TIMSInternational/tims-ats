'use client';

import { useI18n } from '../../../lib/i18n';
import { PageHeader } from '../../../components';
import { MyTasksSection } from './my-tasks-section';
import { MyReportSection } from './my-report-section';

export default function My360Page() {
  const { t } = useI18n();

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader title={t.my360.pageTitle} description={t.my360.pageDescription} />

      <div className="flex-1 space-y-8 overflow-y-auto p-4 md:p-5">
        <MyTasksSection />
        <MyReportSection />
      </div>
    </div>
  );
}
