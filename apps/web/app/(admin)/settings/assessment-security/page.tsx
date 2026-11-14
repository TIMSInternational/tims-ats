'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../../../components';
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
  if (!isProviderAssessmentsStaffEnabled())
    body = <EmptyState icon={<ShieldIcon />} title={m.unavailableTitle} description={m.unavailableBody} />;
  else if (isLoading || settings.isLoading) body = <Skeleton className="h-64 w-full rounded-xl" />;
  else if (!can('assessment', 'update')) body = <EmptyState icon={<ShieldIcon />} title={m.noPermission} />;
  else if (settings.isError || !settings.data)
    body = <ErrorState onRetry={() => void settings.refetch()} error={settings.error} />;
  else body = <AssessmentSecurityForm settings={settings.data} />;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={m.title} description={m.subtitle} />
      <section className="flex flex-1 flex-col overflow-y-auto px-4 py-5 md:px-6 md:py-6">{body}</section>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="size-8 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 3l7.5 3v5.25c0 4.5-3.15 8.4-7.5 9.75-4.35-1.35-7.5-5.25-7.5-9.75V6L12 3z" strokeLinejoin="round" />
    </svg>
  );
}
