'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency } from '../../../../lib/format-utils';
import Link from 'next/link';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  Button,
  ErrorState,
  KpiCard,
  KpiCardSkeleton,
  PageHeader,
  SegmentedControl,
  TEXT_LINK_CLASSES,
  inputClasses,
} from '../../../../components';
import { InvoiceTable } from './invoice-table';
import { ConfirmModal } from './confirm-modal';
import { InvoiceWizard } from './invoice-wizard';
import { InvoiceDetail } from './invoice-detail';
import { BillingProfileDrawer } from './billing-drawer';

type StatusFilter = '' | 'draft' | 'pending' | 'paid' | 'void' | 'overdue';

export default function InvoicesPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const orgFilter = searchParams.get('org') || searchParams.get('orgId') || undefined;
  const autoCreate = searchParams.get('create') === 'true';

  const STATUS_TABS: { value: StatusFilter; label: string }[] = [
    { value: '', label: t.invoices.filterAll },
    { value: 'pending', label: t.invoices.filterPending },
    { value: 'paid', label: t.invoices.filterPaid },
    { value: 'overdue', label: t.invoices.filterOverdue },
    { value: 'void', label: t.invoices.filterVoid },
  ];

  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(autoCreate);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [showBillingDrawer, setShowBillingDrawer] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: 'paid' | 'void' | 'pending' } | null>(null);
  const limit = 15;

  const kpis = trpc.platform.getInvoiceKpis.useQuery();
  const invoices = trpc.platform.listInvoices.useQuery({
    page,
    limit,
    status: statusFilter || undefined,
    search: search || undefined,
    organizationId: orgFilter,
  });
  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.platform.listInvoices.invalidate();
    utils.platform.getInvoiceKpis.invalidate();
  };

  const updateStatus = trpc.platform.updateInvoiceStatus.useMutation({
    onSuccess: (_data, vars) => {
      invalidateAll();
      setConfirmAction(null);
      const done = { paid: t.invoices.markedPaidToast, pending: t.invoices.revertedToast, void: t.invoices.voidedToast } as Record<string, string>;
      toast(done[vars.status] ?? t.invoices.statusUpdated, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const sendReminder = trpc.platform.sendPaymentReminder.useMutation({
    onSuccess: () => { toast(t.invoices.reminderSent, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const exportCsv = trpc.platform.exportInvoicesCsv.useQuery({ status: statusFilter || undefined }, { enabled: false });

  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.isError) {
      toast(t.common.exportError, { type: 'error' });
      return;
    }
    if (result.data) {
      const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facturas-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t.invoices.exportedToast, { type: 'success' });
    }
  };

  const rows = invoices.data?.invoices ?? [];
  const total = invoices.data?.total ?? 0;

  if (showWizard) {
    return (
      <InvoiceWizard
        preselectedOrgId={orgFilter}
        onClose={() => setShowWizard(false)}
        onSuccess={() => { setShowWizard(false); invalidateAll(); }}
      />
    );
  }

  if (viewInvoiceId) {
    return <InvoiceDetail id={viewInvoiceId} onBack={() => setViewInvoiceId(null)} />;
  }

  const iv = t.invoices;
  const numberFor = (id: string) => rows.find((r) => r.id === id)?.invoiceNumber ?? '';
  const confirmMeta = confirmAction ? {
    paid: { title: formatMessage(iv.confirmMarkPaidTitle, { n: numberFor(confirmAction.id) }), message: iv.confirmMarkPaidBody, label: iv.markPaidConfirm, destructive: false },
    pending: { title: formatMessage(iv.confirmRevertTitle, { n: numberFor(confirmAction.id) }), message: iv.confirmRevertBody, label: iv.revertConfirm, destructive: false },
    void: { title: formatMessage(iv.confirmVoidTitle, { n: numberFor(confirmAction.id) }), message: iv.confirmVoidBody, label: iv.voidConfirm, destructive: true },
  }[confirmAction.action] : null;

  const icon = (d: string) => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
  );
  const avgDays = kpis.data?.avgDaysToPay ?? 0;

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        title={iv.title}
        actions={
          <>
            <Button variant="secondary" onClick={handleExport} icon={icon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}>
              {iv.exportCsv}
            </Button>
            <Button onClick={() => setShowWizard(true)} icon={icon('M12 4v16m8-8H4')}>
              {iv.newInvoice}
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-6">
      {/* KPIs */}
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
              label={iv.kpiCollected}
              value={formatCurrency(kpis.data.collected, kpis.data.currency ?? 'USD', 2)}
              subtitle={t.common.paidInvoices}
              icon={icon('M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6')}
            />
            <KpiCard
              label={iv.kpiOutstanding}
              value={formatCurrency(kpis.data.outstanding, kpis.data.currency ?? 'USD', 2)}
              subtitle={t.common.pending}
              icon={icon('M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z')}
            />
            <KpiCard
              label={iv.kpiOverdue}
              value={kpis.data.overdueCount}
              tone="danger"
              highlight={kpis.data.overdueCount > 0}
              subtitle={kpis.data.overdueCount > 0 ? t.common.requiresAttention : t.common.noIssues}
              icon={icon('M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01')}
            />
            <KpiCard
              label={iv.kpiAvgDays}
              value={Math.abs(avgDays)}
              subtitle={avgDays < 0 ? iv.daysBeforeDue : t.common.daysAverage}
              icon={icon('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z')}
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            label={iv.filterStatusLabel}
            options={STATUS_TABS}
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); setPage(0); }}
          />
        </div>
        {orgFilter && (
          <span className="flex items-center gap-2 rounded-lg bg-info-bg px-2.5 py-1 text-callout font-medium text-info">
            {iv.filteringByOrg}
            <Link href="/platform/invoices" className={TEXT_LINK_CLASSES}>{t.common.clearFilters}</Link>
          </span>
        )}
        <div className="relative w-full sm:ml-auto sm:w-64">
          <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            type="search"
            aria-label={iv.searchOrgLabel}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={iv.searchOrg}
            className={inputClasses('md', 'pl-9')}
          />
        </div>
      </div>

      {/* Table */}
      {invoices.isError ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card">
          <ErrorState onRetry={() => invoices.refetch()} error={invoices.error} />
        </div>
      ) : (
      <InvoiceTable
        rows={rows}
        loading={invoices.isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onView={setViewInvoiceId}
        onBillingProfile={setShowBillingDrawer}
        onStatusAction={(id, action) => setConfirmAction({ id, action })}
        onRemind={(id) => sendReminder.mutate({ id })}
        remindPending={sendReminder.isPending}
        onCreate={() => setShowWizard(true)}
      />
      )}
      </div>

      {/* Confirm Modal */}
      {confirmAction && confirmMeta && (
        <ConfirmModal
          title={confirmMeta.title}
          message={confirmMeta.message}
          confirmLabel={confirmMeta.label}
          destructive={confirmMeta.destructive}
          onConfirm={() => updateStatus.mutate({ id: confirmAction.id, status: confirmAction.action })}
          onClose={() => setConfirmAction(null)}
          isPending={updateStatus.isPending}
        />
      )}

      {showBillingDrawer && <BillingProfileDrawer organizationId={showBillingDrawer} onClose={() => setShowBillingDrawer(null)} />}
    </div>
  );
}
