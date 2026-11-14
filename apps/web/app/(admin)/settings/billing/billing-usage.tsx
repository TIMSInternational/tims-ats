'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatNumber } from '../../../../lib/format-utils';
import { useBillingUsage } from '../../../../lib/platform-api/billing';
import { ErrorState, ProgressBar, Skeleton, StatusBadge } from '../../../../components';

interface UsageRowProps {
  label: string;
  used: number;
  limit: number | null;
}

function UsageRow({ label, used, limit }: UsageRowProps) {
  const { t, locale } = useI18n();
  const over = limit != null && used > limit;
  const usedText = formatNumber(used, locale);
  const valueText =
    limit != null
      ? formatMessage(t.billing.usageOf, { used: usedText, limit: formatNumber(limit, locale) })
      : formatMessage(t.billing.usageOf, { used: usedText, limit: t.billing.noLimit });
  return (
    <div className="border-b border-border-subtle py-2.5 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body text-secondary">{label}</span>
        <span className="flex items-center gap-2">
          {over && <StatusBadge tone="danger">{t.billing.overLimit}</StatusBadge>}
          <span className="text-body font-medium tabular-nums text-primary">{valueText}</span>
        </span>
      </div>
      {limit != null && limit > 0 && (
        <ProgressBar
          className="mt-1.5"
          value={Math.min(used, limit)}
          max={limit}
          label={label}
          hideLabel
          valueText={valueText}
          kind="meter"
          tone={over ? 'danger' : 'brand'}
        />
      )}
    </div>
  );
}

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
