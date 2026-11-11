'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, ErrorState, Skeleton } from '../../../../components';
import { isProviderAssessmentsStaffEnabled } from '../../../../lib/platform-api/assessment-providers-staff';
import { useProctoringSettings } from '../../../../lib/platform-api/assessment-provider-settings';
import { AssessmentSecurityForm } from './assessment-security-form';

// /settings/assessment-security — proctoring parity with timssuite.com (owner decision 2026-11-11): the same lockdown,
// alert control and identity check the suite sets per company, sent with every TIMS test assigned from the ATS. The C#
// write needs assessment:update at organization scope; the can() check here is UX only (a 403 shows the same state).
export default function AssessmentSecurityPage() {
  const { t } = useI18n();
  const m = t.assessmentSecurity;
  const { can, isLoading } = usePermissions();
  const settings = useProctoringSettings();

  let body: ReactNode;
  if (!isProviderAssessmentsStaffEnabled()) body = <EmptyState icon={null} message={m.unavailable} />;
  else if (isLoading || settings.isLoading) body = <Skeleton className="h-64 w-full rounded-xl" />;
  else if (!can('assessment', 'update')) body = <EmptyState icon={null} message={m.noPermission} />;
  else if (settings.isError || !settings.data)
    body = <ErrorState onRetry={() => void settings.refetch()} error={settings.error} />;
  else body = <AssessmentSecurityForm settings={settings.data} />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="max-w-2xl">
        <h1 className="text-lg font-semibold text-[#1F114C]">{m.title}</h1>
        <p className="mt-1 text-sm text-[#585858]">{m.subtitle}</p>
      </header>
      <section className="flex flex-col">{body}</section>
    </div>
  );
}
