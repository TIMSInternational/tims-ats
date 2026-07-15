'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatDate } from '../../../../lib/format-utils';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState, ErrorState } from '../../../../components';
import { InvoiceStatusBadge } from './invoice-status-badge';
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
    onSuccess: () => { invalidateAll(); setConfirmAction(null); toast(t.invoices.statusUpdated, { type: 'success' }); },
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
      toast(t.common.error, { type: 'error' });
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

  const confirmMeta = confirmAction ? {
    paid: { title: t.invoices.markPaid, message: t.invoices.confirmMarkPaid, label: t.invoices.markPaidBtn, color: 'bg-green-600 hover:bg-green-700' },
    pending: { title: t.invoices.revert, message: t.invoices.confirmRevert, label: t.invoices.revertBtn, color: 'bg-amber-600 hover:bg-amber-700' },
    void: { title: t.invoices.void, message: t.invoices.confirmVoid, label: t.invoices.voidBtn, color: 'bg-[#DD0C15] hover:bg-red-700' },
  }[confirmAction.action] : null;

  const columns = [
    { key: 'num', label: t.invoices.colNumber },
    { key: 'org', label: t.invoices.colOrganization },
    { key: 'amount', label: t.invoices.colAmount, align: 'right' as const },
    { key: 'status', label: t.invoices.colStatus, align: 'center' as const },
    { key: 'issued', label: t.invoices.colIssued },
    { key: 'due', label: t.invoices.colDue },
    { key: 'actions', label: t.invoices.colActions, align: 'center' as const },
  ];

  const emptyIcon = (
    <svg className="w-12 h-12 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPIs */}
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
              label={t.invoices.kpiCollected}
              value={formatCurrency(kpis.data.collected, kpis.data.currency ?? 'USD', 2)}
              subtitle={t.common.paidInvoices}
              icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.invoices.kpiOutstanding}
              value={formatCurrency(kpis.data.outstanding, kpis.data.currency ?? 'USD', 2)}
              subtitle={t.common.pending}
              valueColor="text-amber-600"
              icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
              iconBg="bg-amber-50"
            />
            <KpiCard
              label={t.invoices.kpiOverdue}
              value={kpis.data.overdueCount}
              subtitle={kpis.data.overdueCount > 0 ? t.common.requiresAttention : t.common.noIssues}
              valueColor={kpis.data.overdueCount > 0 ? 'text-[#DD0C15]' : undefined}
              icon={<svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg>}
              iconBg="bg-red-50"
              highlight={kpis.data.overdueCount > 0}
            />
            <KpiCard
              label={t.invoices.kpiAvgDays}
              value={kpis.data.avgDaysToPay}
              subtitle={t.common.daysAverage}
              icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
              iconBg="bg-blue-50"
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === tab.value ? 'bg-[#1F114C] text-white' : 'bg-white border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}
            >
              {tab.label}
            </button>
          ))}
          {orgFilter && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-xs text-blue-700 font-medium">
              {t.invoices.filteringByOrg}
              <a href="/platform/invoices" className="text-blue-500 hover:underline">{t.invoices.clearFilter}</a>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder={t.invoices.searchOrg}
              className="h-8 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-xs text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 w-52"
            />
          </div>
          <button onClick={handleExport} className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#585858] hover:bg-[#F6F6F6] transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>CSV
          </button>
          <button onClick={() => setShowWizard(true)} className="h-8 px-4 rounded-lg bg-[#1F114C] text-white text-xs font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>{t.invoices.newInvoice}
          </button>
        </div>
      </div>

      {/* Table */}
      {invoices.isError ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
          <ErrorState onRetry={() => invoices.refetch()} />
        </div>
      ) : (
      <DataTable
        columns={columns}
        loading={invoices.isLoading}
        empty={
          <EmptyState
            icon={emptyIcon}
            message={t.invoices.noInvoices}
            action={{ label: t.invoices.createFirst, onClick: () => setShowWizard(true) }}
          />
        }
        pagination={{ page, limit, total, onPageChange: setPage }}
      >
        {rows.map((inv) => {
          const isVoid = inv.status === 'void';
          const isPaid = inv.status === 'paid';
          return (
            <tr
              key={inv.id}
              className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition cursor-pointer ${isVoid ? 'opacity-50' : ''}`}
              onClick={() => setViewInvoiceId(inv.id)}
            >
              <td className="px-4 py-3">
                <span className="text-xs font-semibold text-[#1F114C]">INV-{inv.invoiceNumber}</span>
              </td>
              <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); if (inv.organization?.id) setShowBillingDrawer(inv.organization.id); }}>
                <span className="text-sm text-[#333] font-medium hover:text-[#1F114C] hover:underline cursor-pointer">{inv.organization?.name || '\u2014'}</span>
                {inv.lineItems?.[0]?.description && (
                  <p className="text-[10px] text-[#8B8B8B] truncate max-w-[200px]">
                    {inv.lineItems[0].description}{inv.lineItems.length > 1 ? ` (+${inv.lineItems.length - 1})` : ''}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={`text-sm font-semibold ${isVoid ? 'text-[#8B8B8B] line-through' : 'text-[#333]'}`}>
                  {formatCurrency(inv.amount, inv.currency, 2)}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <InvoiceStatusBadge status={inv.status} dueDate={inv.dueDate} />
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-[#585858]">{formatDate(inv.invoiceDate || inv.createdAt)}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs ${inv.dueDate && new Date(inv.dueDate) < new Date() && inv.status === 'pending' ? 'text-[#DD0C15] font-medium' : 'text-[#585858]'}`}>
                  {formatDate(inv.dueDate)}
                </span>
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-center gap-1.5">
                  {!isPaid && !isVoid && (
                    <>
                      <button onClick={() => setConfirmAction({ id: inv.id, action: 'paid' })} className="text-[10px] text-green-600 font-medium hover:underline">{t.invoices.markPaid}</button>
                      <span className="text-[#EDEDED]">|</span>
                      <button onClick={() => sendReminder.mutate({ id: inv.id })} disabled={sendReminder.isPending} className="text-[10px] text-blue-600 font-medium hover:underline disabled:opacity-50">{t.invoices.sendReminder}</button>
                      <span className="text-[#EDEDED]">|</span>
                    </>
                  )}
                  {isPaid && (
                    <>
                      <button onClick={() => setConfirmAction({ id: inv.id, action: 'pending' })} className="text-[10px] text-amber-600 font-medium hover:underline">{t.invoices.revert}</button>
                      <span className="text-[#EDEDED]">|</span>
                    </>
                  )}
                  {!isVoid ? (
                    <button onClick={() => setConfirmAction({ id: inv.id, action: 'void' })} className="text-[10px] text-[#DD0C15] font-medium hover:underline">{t.invoices.void}</button>
                  ) : (
                    <span className="text-[10px] text-[#8B8B8B]">{t.invoices.voided}</span>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
      )}

      {/* Confirm Modal */}
      {confirmAction && confirmMeta && (
        <ConfirmModal
          title={confirmMeta.title}
          message={confirmMeta.message}
          confirmLabel={confirmMeta.label}
          confirmColor={confirmMeta.color}
          onConfirm={() => updateStatus.mutate({ id: confirmAction.id, status: confirmAction.action })}
          onClose={() => setConfirmAction(null)}
          isPending={updateStatus.isPending}
        />
      )}

      {showBillingDrawer && <BillingProfileDrawer organizationId={showBillingDrawer} onClose={() => setShowBillingDrawer(null)} />}
    </div>
  );
}
