'use client';

import { trpc } from '../../../../lib/trpc';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { EmptyState, ErrorState, KpiCard, KpiCardSkeleton, PageHeader, Skeleton } from '../../../../components';
import { formatCurrency, formatNumber, formatPercent } from '../../../../lib/format-utils';
import { GrowthChart } from './growth-chart';
import { AiUsageCard } from './ai-usage-card';
import { DistributionCard } from './distribution-card';

function signedPct(delta: number) {
  return `${delta >= 0 ? '+' : ''}${delta}`;
}

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const an = t.analytics;
  const plans = an.plans as Record<string, string>;
  const modules = an.modules as Record<string, string>;
  const { data, isLoading, isError, error, refetch } = trpc.platform.getAnalytics.useQuery();

  const header = <PageHeader title={t.platformSidebar.analytics} description={an.pageDescription} />;
  const shell = (body: React.ReactNode) => (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6">{body}</div>
    </div>
  );

  if (isLoading) {
    return shell(
      <div aria-busy="true" className="space-y-5">
        <span className="sr-only">{t.common.loadingContent}</span>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>,
    );
  }
  if (isError) {
    return shell(
      <div className="rounded-xl bg-white shadow-card">
        <ErrorState onRetry={() => refetch()} error={error} message={an.loadError} />
      </div>,
    );
  }
  if (!data) {
    return shell(
      <div className="rounded-xl bg-white shadow-card">
        <EmptyState title={an.noData} />
      </div>,
    );
  }

  const subscriptionEntries = Object.entries(data.subscriptionsByPlan ?? {}) as [string, number][];
  const totalSubs = subscriptionEntries.reduce((sum, [, count]) => sum + count, 0);
  const delta = (now: number, prev: number) => (prev > 0 ? Math.round(((now - prev) / prev) * 100) : now > 0 ? 100 : 0);
  const orgDelta = delta(data.newOrgsThisMonth, data.newOrgsPrevMonth);
  const userDelta = delta(data.newUsersThisMonth, data.newUsersPrevMonth);
  const geoMax = data.geo[0]?.count || 1;

  return shell(
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard
          label={an.newOrgs}
          value={`+${formatNumber(data.newOrgsThisMonth, locale)}`}
          subtitle={formatMessage(an.vsPrevMonthPct, { pct: signedPct(orgDelta) })}
        />
        <KpiCard
          label={an.newUsers}
          value={`+${formatNumber(data.newUsersThisMonth, locale)}`}
          subtitle={formatMessage(an.vsPrevMonthPct, { pct: signedPct(userDelta) })}
        />
        <KpiCard
          label={an.churnRate}
          value={formatPercent(data.churnRate, locale, 1)}
          subtitle={an.monthly}
          tone={data.churnRate > 3 ? 'danger' : undefined}
        />
        <KpiCard label={an.arpu} value={formatCurrency(data.arpu)} subtitle={an.usdOrgMonth} />
        <KpiCard label={an.dauMau} value={formatPercent(data.dauMauRatio, locale)} subtitle={an.engagementRatio} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[11fr_9fr]">
        <div className="min-w-0 space-y-5">
          <GrowthChart growth={data.growth} totalOrgs={data.totalOrgs} totalUsers={data.totalUsers} />
          <DistributionCard
            id="plan-distribution-title"
            title={an.planDistribution}
            emptyText={an.noSubData}
            rows={
              totalSubs > 0
                ? subscriptionEntries.map(([plan, count]) => {
                    const pct = Math.round((count / totalSubs) * 100);
                    return {
                      key: plan,
                      label: plans[plan] ?? plan,
                      pct,
                      valueText: `${formatPercent(pct, locale)} · ${formatNumber(count, locale)}`,
                    };
                  })
                : []
            }
            footer={`${an.totalSubs}: ${formatNumber(totalSubs, locale)}`}
          />
          <DistributionCard
            id="module-adoption-title"
            title={an.moduleAdoption}
            emptyText={an.noModuleData}
            rows={data.moduleAdoption.map((mod) => ({
              key: mod.key,
              label: modules[mod.key] ?? mod.key,
              pct: mod.pct,
              valueText: formatPercent(mod.pct, locale),
            }))}
            footer={an.pctOrgsUsingModule}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <AiUsageCard usage={data.aiUsage} />
          <DistributionCard
            id="geo-distribution-title"
            title={an.geoDistribution}
            emptyText={an.noGeoData}
            rows={data.geo.map((c) => ({
              key: c.country,
              label: c.country,
              pct: Math.round((c.count / geoMax) * 100),
              valueText: formatNumber(c.count, locale),
            }))}
            footer={`${an.totalUsers}: ${formatNumber(data.totalUsers, locale)}`}
          />
          <section aria-labelledby="revenue-title" className="rounded-xl bg-white p-5 shadow-card">
            <h2 id="revenue-title" className="mb-3 text-heading font-semibold text-brand">
              {an.revenue}
            </h2>
            <p className="text-callout text-secondary">{an.estimatedMrr}</p>
            <p className="text-title font-semibold tabular-nums text-primary">{formatCurrency(data.mrr)}</p>
            <p className="mt-1 text-callout text-secondary">{an.mrrFormula}</p>
          </section>
        </div>
      </div>
    </>,
  );
}
