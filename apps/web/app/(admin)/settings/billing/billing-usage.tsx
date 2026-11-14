'use client';

import { useI18n } from '../../../../lib/i18n';
import { useBillingUsage } from '../../../../lib/platform-api/billing';
import { ErrorState, Skeleton } from '../../../../components';
import { UsageRow } from './usage-row';

/** "Uso": used vs limit per resource; skeleton rows while it loads (loading.md › Best practices). */
export function BillingUsage() {
  const { t } = useI18n();
  const usage = useBillingUsage();

  return (
    <section aria-labelledby="billing-usage-title" className="rounded-xl border border-border bg-white p-5">
      <h2 id="billing-usage-title" className="mb-2 text-subheading font-semibold text-primary">
        {t.billing.usageTitle}
      </h2>
      {usage.isError ? (
        <ErrorState size="compact" onRetry={() => usage.refetch()} />
      ) : !usage.data ? (
        <div className="space-y-4 py-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div>
          <UsageRow
            label={t.billing.usageEmployees}
            used={usage.data.employees.used}
            limit={usage.data.employees.limit}
          />
          <UsageRow
            label={t.billing.usageVacancies}
            used={usage.data.vacancies.used}
            limit={usage.data.vacancies.limit}
          />
          <UsageRow
            label={t.billing.usageAssessments}
            used={usage.data.assessments.used}
            limit={usage.data.assessments.limit}
          />
        </div>
      )}
    </section>
  );
}
