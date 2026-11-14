'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, ErrorState, KpiCard, KpiCardSkeleton, PageHeader } from '../../../../components';
import { MrrTrendChart } from './mrr-trend-chart';
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
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const reactivateSub = trpc.platform.reactivateSubscription.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast(t.subscriptions.reactivatedToast, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const sendReminder = trpc.platform.sendDunningReminder.useMutation({
    onSuccess: (data) => {
      toast(formatMessage(t.subscriptions.reminderSentToast, { org: data.orgName }), { type: 'success' });
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
      toast(t.common.exportError, { type: 'error' });
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
      toast(formatMessage(t.subscriptions.rowsExported, { count: result.data.count }), { type: 'success' });
    }
  };

  const handlePlanChange = (newPlan: string) => {
    if (!planChangeTarget) return;
    updateSub.mutate(
      { organizationId: planChangeTarget.organizationId, plan: newPlan as 'starter' | 'professional' | 'enterprise' },
      { onSuccess: () => { setPlanChangeTarget(null); toast(t.subscriptions.planUpdatedToast, { type: 'success' }); } },
    );
  };

  const handleCancel = () => {
    if (!cancelTarget) return;
    updateSub.mutate(
      { organizationId: cancelTarget.organizationId, status: 'cancelled' as const },
      { onSuccess: () => { setCancelTarget(null); toast(t.subscriptions.cancelledToast, { type: 'success' }); } },
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
    updateSub.mutate(
      { organizationId, trialEndsAt: newEnd },
      { onSuccess: () => toast(t.subscriptions.trialExtendedToast, { type: 'success' }) },
    );
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPlanFilter('');
    setPage(0);
  };

  const subscriptions = subs.data?.subscriptions ?? [];
  const total = subs.data?.total ?? 0;

  const sb = t.subscriptions;
  const icon = (d: string) => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
  );

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        title={sb.title}
        actions={
          <Button variant="secondary" onClick={handleExportCsv} icon={icon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}>
            {sb.exportCsv}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-6">
      {/* KPI Row */}
      <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:mb-5 md:grid-cols-4 md:gap-4">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 rounded-xl bg-white shadow-card md:col-span-4">
            <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} size="compact" />
          </div>
        ) : kpis.data ? (
          <>
            <KpiCard
              label={sb.kpiMrr}
              value={formatCurrency(kpis.data.mrr)}
              subtitle={formatMessage(sb.mrrChange, { change: `${kpis.data.mrrChangePercent >= 0 ? '+' : ''}${kpis.data.mrrChangePercent}` })}
              icon={icon('M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6')}
            />
            <KpiCard
              label={sb.kpiActive}
              value={kpis.data.active}
              subtitle={formatMessage(sb.shareOfOrgs, { pct: kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0 })}
              icon={icon('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}
            />
            <KpiCard
              label={sb.kpiExpiring}
              value={kpis.data.expiringTrials.length}
              tone="warning"
              subtitle={sb.expireIn7Days}
              icon={icon('M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01')}
            />
            <KpiCard
              label={sb.kpiPastDue}
              value={kpis.data.pastDue}
              tone="danger"
              highlight={kpis.data.pastDue > 0}
              subtitle={kpis.data.pastDue > 0 ? t.common.requiresAttention : t.common.noIssues}
              icon={icon('M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636')}
            />
          </>
        ) : null}
      </div>

      {/* The page's one actionable warning sits right under the KPIs (feedback.md). */}
      {kpis.data && kpis.data.expiringTrials.length > 0 && (
        <TrialsAlert
          trials={kpis.data.expiringTrials}
          onExtendTrial={handleExtendTrial}
          isUpdating={updateSub.isPending}
        />
      )}

      <MrrTrendChart />

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
        hasFilters={!!(search || statusFilter || planFilter)}
      />

      {/* Table */}
      <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
        {subs.isError ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card">
            <ErrorState onRetry={() => subs.refetch()} error={subs.error} />
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
      </div>
      </div>

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
