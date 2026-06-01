'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { fmtCurrency, fmtDate, Skeleton } from './_helpers';
import { InvoiceWizard } from './invoice-wizard';
import { InvoiceDetail } from './invoice-detail';
import { BillingProfileDrawer } from './billing-drawer';

function statusBadge(status: string, dueDate?: Date | string | null, labels?: { draft: string; pending: string; paid: string; void: string; overdue: string }) {
  const l = labels || { draft: 'Borrador', pending: 'Pendiente', paid: 'Pagada', void: 'Anulada', overdue: 'Vencida' };
  const isOverdue = status === 'pending' && dueDate && new Date(dueDate) < new Date();
  if (isOverdue) return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700">{l.overdue}</span>;
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'bg-gray-100 text-gray-600', label: l.draft },
    pending: { cls: 'bg-amber-100 text-amber-700', label: l.pending },
    paid: { cls: 'bg-green-100 text-green-700', label: l.paid },
    void: { cls: 'bg-gray-100 text-gray-500', label: l.void },
  };
  const m = map[status] || { cls: 'bg-gray-100 text-gray-600', label: status };
  return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}

export default function InvoicesPage() {
  const { t } = useI18n();

  const STATUS_TABS = [
    { value: '', label: t.invoices.filterAll },
    { value: 'pending', label: t.invoices.filterPending },
    { value: 'paid', label: t.invoices.filterPaid },
    { value: 'overdue', label: t.invoices.filterOverdue },
    { value: 'void', label: t.invoices.filterVoid },
  ];
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [showBillingDrawer, setShowBillingDrawer] = useState<string | null>(null);
  const limit = 15;

  const kpis = trpc.platform.getInvoiceKpis.useQuery();
  const invoices = trpc.platform.listInvoices.useQuery({ page, limit, status: statusFilter || undefined, search: search || undefined });
  const utils = trpc.useUtils();

  const updateStatus = trpc.platform.updateInvoiceStatus.useMutation({
    onSuccess: () => { utils.platform.listInvoices.invalidate(); utils.platform.getInvoiceKpis.invalidate(); toast('Estado de factura actualizado', { type: 'success' }); },
    onError: (err) => { toast(err.message || 'Error al actualizar estado', { type: 'error' }); },
  });
  const sendReminder = trpc.platform.sendPaymentReminder.useMutation({
    onSuccess: () => { toast('Recordatorio de pago enviado', { type: 'success' }); },
    onError: (err) => { toast(err.message || 'Error al enviar recordatorio', { type: 'error' }); },
  });
  const exportCsv = trpc.platform.exportInvoicesCsv.useQuery({ status: statusFilter || undefined }, { enabled: false });

  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.data) {
      const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `facturas-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const rows = invoices.data?.invoices ?? [];
  const total = invoices.data?.total ?? 0;

  if (showWizard) {
    return <InvoiceWizard onClose={() => setShowWizard(false)} onSuccess={() => { setShowWizard(false); utils.platform.listInvoices.invalidate(); utils.platform.getInvoiceKpis.invalidate(); }} />;
  }

  if (viewInvoiceId) {
    return <InvoiceDetail id={viewInvoiceId} onBack={() => setViewInvoiceId(null)} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse"><Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3 w-20" /></div>
        )) : kpis.data ? <>
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.invoices.kpiCollected}</span><div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg></div></div>
            <div className="text-2xl font-bold text-[#333]">{fmtCurrency(kpis.data.collected)}</div><div className="text-xs text-green-500 mt-1 font-medium">{t.common.paidInvoices}</div>
          </div>
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.invoices.kpiOutstanding}</span><div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg></div></div>
            <div className="text-2xl font-bold text-amber-600">{fmtCurrency(kpis.data.outstanding)}</div><div className="text-xs text-amber-500 mt-1 font-medium">{t.common.pending}</div>
          </div>
          <div className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${kpis.data.overdueCount > 0 ? 'border border-red-200' : ''}`}>
            <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.invoices.kpiOverdue}</span><div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"><svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg></div></div>
            <div className={`text-2xl font-bold ${kpis.data.overdueCount > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{kpis.data.overdueCount}</div><div className={`text-xs mt-1 font-medium ${kpis.data.overdueCount > 0 ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>{kpis.data.overdueCount > 0 ? t.common.requiresAttention : t.common.noIssues}</div>
          </div>
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.invoices.kpiAvgDays}</span><div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div></div>
            <div className="text-2xl font-bold text-[#333]">{kpis.data.avgDaysToPay}</div><div className="text-xs text-[#8B8B8B] mt-1">{t.common.daysAverage}</div>
          </div>
        </> : null}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <button key={tab.value} onClick={() => { setStatusFilter(tab.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === tab.value ? 'bg-[#1F114C] text-white' : 'bg-white border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{tab.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t.invoices.searchOrg} className="h-8 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-xs text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 w-52" />
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
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-[#EDEDED]">
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-5 py-3">#</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Organizacion</th>
                <th className="text-right text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Monto</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Estado</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Emision</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Vencimiento</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F6F6F6] animate-pulse"><td className="px-5 py-3"><div className="h-4 w-16 bg-gray-200 rounded" /></td><td className="px-4 py-3"><div className="h-4 w-32 bg-gray-200 rounded" /></td><td className="px-4 py-3"><div className="h-4 w-16 bg-gray-100 rounded ml-auto" /></td><td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-full mx-auto" /></td><td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td><td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td><td className="px-4 py-3"><div className="h-4 w-24 bg-gray-100 rounded mx-auto" /></td></tr>
              )) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center">
                  <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                  <p className="text-sm text-[#8B8B8B]">{t.invoices.noInvoices}</p>
                  <button onClick={() => setShowWizard(true)} className="mt-3 text-xs text-[#1F114C] font-medium hover:underline">{t.invoices.createFirst}</button>
                </td></tr>
              ) : rows.map((inv) => {
                const isVoid = inv.status === 'void'; const isPaid = inv.status === 'paid';
                return (
                  <tr key={inv.id} className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition cursor-pointer ${isVoid ? 'opacity-50' : ''}`} onClick={() => setViewInvoiceId(inv.id)}>
                    <td className="px-5 py-3"><span className="text-xs font-semibold text-[#1F114C]">INV-{inv.invoiceNumber}</span></td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#333] font-medium">{inv.organization?.name || '\u2014'}</span>
                      {inv.lineItems?.[0]?.description && <p className="text-[10px] text-[#8B8B8B] truncate max-w-[200px]">{inv.lineItems[0].description}{inv.lineItems.length > 1 ? ` (+${inv.lineItems.length - 1})` : ''}</p>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className={`text-sm font-semibold ${isVoid ? 'text-[#8B8B8B] line-through' : 'text-[#333]'}`}>{fmtCurrency(inv.amount, inv.currency)}</span></td>
                    <td className="px-4 py-3 text-center">{statusBadge(inv.status, inv.dueDate, { draft: t.invoices.statusDraft, pending: t.invoices.statusPending, paid: t.invoices.statusPaid, void: t.invoices.statusVoid, overdue: t.invoices.statusOverdue })}</td>
                    <td className="px-4 py-3"><span className="text-xs text-[#585858]">{fmtDate(inv.invoiceDate || inv.createdAt)}</span></td>
                    <td className="px-4 py-3"><span className={`text-xs ${inv.dueDate && new Date(inv.dueDate) < new Date() && inv.status === 'pending' ? 'text-[#DD0C15] font-medium' : 'text-[#585858]'}`}>{fmtDate(inv.dueDate)}</span></td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        {!isPaid && !isVoid && <>
                          <button onClick={() => { if (confirm('Marcar como pagada?')) updateStatus.mutate({ id: inv.id, status: 'paid' }); }} disabled={updateStatus.isPending} className="text-[10px] text-green-600 font-medium hover:underline disabled:opacity-50">{t.invoices.markPaid}</button><span className="text-[#EDEDED]">|</span>
                          <button onClick={() => sendReminder.mutate({ id: inv.id })} disabled={sendReminder.isPending} className="text-[10px] text-blue-600 font-medium hover:underline disabled:opacity-50">{t.invoices.sendReminder}</button><span className="text-[#EDEDED]">|</span>
                        </>}
                        {isPaid && <><button onClick={() => { if (confirm('Revertir a pendiente?')) updateStatus.mutate({ id: inv.id, status: 'pending' }); }} disabled={updateStatus.isPending} className="text-[10px] text-amber-600 font-medium hover:underline disabled:opacity-50">{t.invoices.revert}</button><span className="text-[#EDEDED]">|</span></>}
                        {!isVoid ? <button onClick={() => { if (confirm('Anular factura?')) updateStatus.mutate({ id: inv.id, status: 'void' }); }} disabled={updateStatus.isPending} className="text-[10px] text-[#DD0C15] font-medium hover:underline disabled:opacity-50">{t.invoices.void}</button> : <span className="text-[10px] text-[#8B8B8B]">{t.invoices.voided}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#EDEDED] flex-shrink-0">
          <span className="text-xs text-[#8B8B8B]">{t.invoices.showing} {rows.length > 0 ? page * limit + 1 : 0}-{page * limit + rows.length} {t.invoices.of} {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg></button>
            {Array.from({ length: Math.min(Math.ceil(total / limit), 5) }).map((_, i) => (<button key={i} onClick={() => setPage(i)} className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{i + 1}</button>))}
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>
          </div>
        </div>
      </div>

      {showBillingDrawer && <BillingProfileDrawer organizationId={showBillingDrawer} onClose={() => setShowBillingDrawer(null)} />}
    </div>
  );
}
