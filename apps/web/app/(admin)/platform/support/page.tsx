'use client';

import { useI18n } from '../../../../lib/i18n';
import { PageHeader } from '../../../../components';
import { QuickActions } from './quick-actions';
import { PlatformOwnerSection } from './platform-owner-section';
import { DataRequests } from './data-requests';
import { SystemInfo } from './system-info';

export default function SupportPage() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t.platformSidebar.supportPage} description={t.support.pageDescription} />
      <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <QuickActions />
        <PlatformOwnerSection />
        <DataRequests />
        <SystemInfo />
      </div>
    </div>
  );
}
