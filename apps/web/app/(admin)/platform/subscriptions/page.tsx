'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useDashboardMrrTrend } from '../../../../lib/platform-api/dashboard';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import { KpiCard, KpiCardSkeleton, ErrorState } from '../../../../components';
import { FilterBar } from './filter-bar';
import { SubTable } from './sub-table';
import { TrialsAlert } from './trials-alert';
import { PlanChangeModal } from './plan-change-modal';
import { CancelModal } from './cancel-modal';
import type { SubscriptionListItem } from '../../../../lib/trpc-types';

export default function SubscriptionsPage() {
  const { t } = useI18n();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const limit = 10;

  const [planChangeTarget, setPlanChangeTarget] = useState<SubscriptionListItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SubscriptionListItem | null>(null);

  const kpis = trpc.platform.getSubscriptionKpis.useQuery();
  const mrrTrend = useDashboardMrrTrend();
  const subs = trpc.platform.listSubscriptions.useQuery({
    page,
    limit,
    search: search || undefined,
    status: statusFilter ? (statusFilter as 'active' | 'trialing' | 'past_due' | 'cancelled') : undefined,
    plan: planFilter ? (planFilter as 'trial' | 'starter' | 'professional' | 'enterprise') : undefined,
  });

  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.platform.listSubscriptions.invalidate();
    utils.platform.getSubscriptionKpis.invalidate();
  };

  const updateSub = trpc.platform.updateSubscription.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(t.common.save, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const reactivateSub = trpc.platform.reactivateSubscription.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(t.subscriptions.reactivate, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const sendReminder = trpc.platform.sendDunningReminder.useMutation({
    onSuccess: (data) => {
      toast(`${t.subscriptions.sendReminder}: ${data.orgName}`, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const exportCsv = trpc.platform.exportSubscriptionsCsv.useQuery(
    {
      status: statusFilter ? (statusFilter as 'active' | 'trialing' | 'past_due' | 'cancelled') : undefined,
      plan: planFilter ? (planFilter as 'trial' | 'starter' | 'professional' | 'enterprise') : undefined,
    },
    { enabled: false },
  );

  const handleExportCsv = async () => {
    const result = await exportCsv.refetch();
    if (result.isError) {
      toast(t.common.error, { type: 'error' });
      return;
    }
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suscripciones-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t.subscriptions.exportCsv}: ${result.data.count}`, { type: 'success' });
    }
  };

  const handlePlanChange = (newPlan: string) => {
    if (!planChangeTarget) return;
    updateSub.mutate(
      { organizationId: planChangeTarget.organizationId, plan: newPlan as 'starter' | 'professional' | 'enterprise' },
      { onSuccess: () => setPlanChangeTarget(null) },
    );
  };

  const handleCancel = () => {
    if (!cancelTarget) return;
    updateSub.mutate(
      { organizationId: cancelTarget.organizationId, status: 'cancelled' as const },
      { onSuccess: () => setCancelTarget(null) },
    );
  };

  const handleReactivate = (sub: SubscriptionListItem) => {
    reactivateSub.mutate({ organizationId: sub.organizationId });
  };

  const handleSendReminder = (sub: SubscriptionListItem) => {
    sendReminder.mutate({ organizationId: sub.organizationId });
  };

  const handleExtendTrial = (organizationId: string) => {
    const newEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    updateSub.mutate({ organizationId, trialEndsAt: newEnd });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPlanFilter('');
    setPage(0);
  };

  const subscriptions = subs.data?.subscriptions ?? [];
  const total = subs.data?.total ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 md:col-span-4 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <ErrorState onRetry={() => kpis.refetch()} />
          </div>
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.subscriptions.kpiMrr}
              value={formatCurrency(kpis.data.mrr)}
              subtitle={`${kpis.data.mrrChangePercent >= 0 ? '+' : ''}${kpis.data.mrrChangePercent}% ${t.subscriptions.vsLastMonth}`}
              icon={
                <svg
                  className="w-4 h-4 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" />
                </svg>
              }
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.subscriptions.kpiActive}
              value={kpis.data.active}
              subtitle={`${kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0}% ${t.subscriptions.ofTotalOrgs}`}
              icon={
                <svg
                  className="w-4 h-4 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <path d="M22 4L12 14.01l-3-3" />
                </svg>
              }
              iconBg="bg-blue-50"
            />
            <KpiCard
              label={t.subscriptions.kpiExpiring}
              value={kpis.data.expiringTrials.length}
              subtitle={t.subscriptions.expireIn7Days}
              icon={
                <svg
                  className="w-4 h-4 text-amber-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
                </svg>
              }
              iconBg="bg-amber-50"
              highlight={kpis.data.expiringTrials.length > 0}
            />
            <KpiCard
              label={t.subscriptions.kpiPastDue}
              value={kpis.data.pastDue}
              subtitle={kpis.data.pastDue > 0 ? t.common.requiresAttention : t.common.noIssues}
              valueColor={kpis.data.pastDue > 0 ? 'text-[#DD0C15]' : undefined}
              icon={
                <svg
                  className="w-4 h-4 text-[#DD0C15]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9l-6 6M9 9l6 6" />
                </svg>
              }
              iconBg="bg-red-50"
              highlight={kpis.data.pastDue > 0}
            />
          </>
        ) : null}
      </div>

      {/* MRR Trend Chart */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#333]">{t.subscriptions.mrrTrend}</h3>
          <span className="text-xs text-[#8B8B8B]">{t.subscriptions.lastMonths}</span>
        </div>
        {mrrTrend.isLoading ? (
          <div className="h-[130px] animate-pulse">
            <div className="h-full w-full bg-gray-100 rounded" />
          </div>
        ) : mrrTrend.isError ? (
          <ErrorState onRetry={() => mrrTrend.refetch()} />
        ) : mrrTrend.data ? (
          (() => {
            const last6 = mrrTrend.data.slice(-6);
            const max = Math.max(...last6.map((m) => m.mrr), 1);
            const BAR_AREA_PX = 90;
            return (
              <div className="flex items-end gap-4 px-2" style={{ height: 130 }}>
                {last6.map((m, i) => {
                  const barH = m.mrr > 0 ? Math.max(Math.round((m.mrr / max) * BAR_AREA_PX), 6) : 3;
                  const isLast = i === last6.length - 1;
                  const opacity = m.mrr === 0 ? 0 : 0.2 + (i / 5) * 0.8;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
                      <span
                        className={`text-[10px] font-medium ${isLast ? 'text-green-600 font-bold' : 'text-[#8B8B8B]'}`}
                      >
                        {m.mrr === 0 ? '$0' : `$${m.mrr >= 1000 ? (m.mrr / 1000).toFixed(1) + 'K' : m.mrr}`}
                      </span>
                      <div
                        className="w-full rounded-t-md flex-shrink-0"
                        style={{
                          height: barH,
                          backgroundColor:
                            m.mrr === 0 ? '#EDEDED' : isLast ? '#22c55e' : `rgba(34, 197, 94, ${opacity})`,
                        }}
                      />
                      <span
                        className={`text-[10px] flex-shrink-0 ${isLast ? 'text-[#333] font-medium' : 'text-[#8B8B8B]'}`}
                      >
                        {m.month.charAt(0).toUpperCase() + m.month.slice(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : null}
      </div>

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        statusFilter={statusFilter}
        onStatusChange={(v) => {
          setStatusFilter(v);
          setPage(0);
        }}
        planFilter={planFilter}
        onPlanChange={(v) => {
          setPlanFilter(v);
          setPage(0);
        }}
        onClearFilters={clearFilters}
        onExportCsv={handleExportCsv}
        hasFilters={!!(search || statusFilter || planFilter)}
      />

      {/* Table */}
      {subs.isError ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
          <ErrorState onRetry={() => subs.refetch()} />
        </div>
      ) : (
        <SubTable
          subscriptions={subscriptions}
          isLoading={subs.isLoading}
          page={page}
          limit={limit}
          total={total}
          onPageChange={setPage}
          onChangePlan={setPlanChangeTarget}
          onCancel={setCancelTarget}
          onReactivate={handleReactivate}
          onSendReminder={handleSendReminder}
        />
      )}

      {/* Trials Alert */}
      {kpis.data && kpis.data.expiringTrials.length > 0 && (
        <TrialsAlert
          trials={kpis.data.expiringTrials}
          onExtendTrial={handleExtendTrial}
          isUpdating={updateSub.isPending}
        />
      )}

      {/* Modals */}
      {planChangeTarget && (
        <PlanChangeModal
          orgName={planChangeTarget.organization?.name || ''}
          currentPlan={planChangeTarget.plan || 'starter'}
          onConfirm={handlePlanChange}
          onClose={() => setPlanChangeTarget(null)}
          isPending={updateSub.isPending}
        />
      )}
      {cancelTarget && (
        <CancelModal
          orgName={cancelTarget.organization?.name || ''}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
          isPending={updateSub.isPending}
        />
      )}
    </div>
  );
}
