'use client';

import { QuickActions } from './quick-actions';
import { PlatformOwnerSection } from './platform-owner-section';
import { DataRequests } from './data-requests';
import { SystemInfo } from './system-info';

export default function SupportPage() {
  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <QuickActions />
      <PlatformOwnerSection />
      <DataRequests />
      <SystemInfo />
    </div>
  );
}
