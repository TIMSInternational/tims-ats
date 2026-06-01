'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { InvoiceListItem, OrganizationListItem, InvoiceDetail as InvoiceDetailType } from '../../../../lib/trpc-types';

function fmtCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function fmtDateLong(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));
}

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

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
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

// ===========================
// INVOICE WIZARD (Mercury-style)
// ===========================

interface LineItem { description: string; quantity: number; unitPrice: number; }

function InvoiceWizard({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0); // 0=customer, 1=setup, 2=details, 3=review
  const [previewTab, setPreviewTab] = useState<'invoice' | 'email'>('invoice');

  // Form state
  const [orgId, setOrgId] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [memo, setMemo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [doSend, setDoSend] = useState(true);

  const orgs = trpc.platform.listOrganizations.useQuery({ search: orgSearch || undefined, limit: 10, page: 0 });
  const nextNum = trpc.platform.getNextInvoiceNumber.useQuery();
  const createInvoice = trpc.platform.createInvoice.useMutation({
    onSuccess: () => { toast('Factura creada exitosamente', { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message || 'Error al crear factura', { type: 'error' }); },
  });

  const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const invNumber = `INV-${nextNum.data ?? '...'}`;

  const addLine = () => setLineItems([...lineItems, { description: '', quantity: 1, unitPrice: 0 }]);
  const removeLine = (i: number) => { if (lineItems.length > 1) setLineItems(lineItems.filter((_, idx) => idx !== i)); };
  const updateLine = (i: number, field: keyof LineItem, val: string | number) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: val };
    setLineItems(updated);
  };

  const selectOrg = (org: OrganizationListItem) => {
    setOrgId(org.id); setOrgSearch(org.name); setOrgName(org.name);
    setEmailTo(org.billingEmail || '');
    setOrgEmail(org.billingEmail || '');
    setStep(1);
  };

  const canNext = () => {
    if (step === 0) return !!orgId;
    if (step === 1) return lineItems.some(li => li.description && li.unitPrice > 0);
    if (step === 2) return !!invoiceDate;
    return true;
  };

  const handleSubmit = (send: boolean) => {
    const validItems = lineItems.filter(li => li.description && li.unitPrice > 0);
    if (!orgId || validItems.length === 0) return;
    createInvoice.mutate({
      organizationId: orgId,
      currency,
      invoiceDate: new Date(invoiceDate),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      poNumber: poNumber || undefined,
      notes: notes || undefined,
      memo: memo || undefined,
      emailTo: emailTo || undefined,
      emailCc: emailCc || undefined,
      sendEmail: send,
      lineItems: validItems,
    });
  };

  const STEPS = [t.invoices.stepCustomer, t.invoices.stepSetup, t.invoices.stepDetails, t.invoices.stepReview];

  return (
    <div className="h-full flex flex-col bg-[#FAFAFA]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#EDEDED] flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h1 className="text-lg font-semibold text-[#333]">{t.invoices.wizardTitle}</h1>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <div className={`w-6 h-[2px] ${i <= step ? 'bg-[#1F114C]' : 'bg-[#EDEDED]'}`} />}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${i < step ? 'bg-[#1F114C] text-white' : i === step ? 'bg-[#1F114C] text-white' : 'bg-[#EDEDED] text-[#8B8B8B]'}`}>{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content — left form + right preview */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left — Form */}
        <div className="w-1/2 overflow-y-auto p-8 border-r border-[#EDEDED]">
          {step === 0 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.selectCustomer}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">{t.invoices.selectCustomerDesc}</p>
              <input type="text" value={orgSearch} onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); }} placeholder={t.invoices.searchOrg} className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 mb-2" />
              {orgId && <div className="flex items-center gap-3 p-4 rounded-xl bg-[#1F114C]/5 border border-[#1F114C]/10 mt-4">
                <div className="w-10 h-10 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-sm font-bold">{orgName.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-semibold text-[#333]">{orgName}</p><p className="text-xs text-[#8B8B8B]">{orgEmail || 'Sin email'}</p></div>
                <button onClick={() => { setOrgId(''); setOrgSearch(''); setOrgName(''); }} className="text-xs text-[#1F114C] font-medium hover:underline">Cambiar</button>
              </div>}
              {orgSearch && !orgId && orgs.data && <div className="mt-1 bg-white border border-[#EDEDED] rounded-xl shadow-lg max-h-60 overflow-y-auto">
                {orgs.data.organizations.length === 0 && <p className="px-4 py-3 text-sm text-[#8B8B8B]">Sin resultados</p>}
                {orgs.data.organizations.map((org) => (
                  <button key={org.id} type="button" onClick={() => selectOrg(org)} className="w-full text-left px-4 py-3 text-sm hover:bg-[#F6F6F6] transition flex items-center gap-3 border-b border-[#F6F6F6] last:border-0">
                    <div className="w-8 h-8 rounded-md bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">{org.name.slice(0, 2).toUpperCase()}</div>
                    <div><span className="font-medium text-[#333]">{org.name}</span><br /><span className="text-xs text-[#8B8B8B]">{org.slug}</span></div>
                  </button>
                ))}
              </div>}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.invoiceSetup}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">Agrega los items y detalles de la factura.</p>
              {/* Customer card */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F6F6F6] mb-6">
                <div className="w-9 h-9 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-xs font-bold">{orgName.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-semibold text-[#333]">{orgName}</p><p className="text-[11px] text-[#8B8B8B]">{orgEmail}</p></div>
                <button onClick={() => setStep(0)} className="text-xs text-[#1F114C] font-medium hover:underline">Editar</button>
              </div>
              {/* Line items */}
              <div className="mb-4">
                <div className="grid grid-cols-[1fr_70px_100px_32px] gap-2 mb-2">
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.item}</span>
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.quantity}</span>
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.unitPrice}</span>
                  <span />
                </div>
                {lineItems.map((li, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_100px_32px] gap-2 mb-2">
                    <input type="text" value={li.description} onChange={(e) => updateLine(i, 'description', e.target.value)} placeholder="Descripcion del item..." className="h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    <input type="number" min="1" value={li.quantity} onChange={(e) => updateLine(i, 'quantity', parseInt(e.target.value) || 1)} className="h-10 px-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] text-center focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8B8B] text-sm">$</span>
                      <input type="number" step="0.01" min="0" value={li.unitPrice || ''} onChange={(e) => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)} placeholder="0.00" className="h-10 pl-7 pr-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] w-full focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    </div>
                    <button onClick={() => removeLine(i)} className="h-10 w-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#8B8B8B] hover:text-[#DD0C15] transition" disabled={lineItems.length <= 1}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button onClick={addLine} className="text-xs text-[#1F114C] font-medium hover:underline flex items-center gap-1 mt-1"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>{t.invoices.addItem}</button>
              </div>
              <div className="flex justify-between items-center py-3 border-t border-[#EDEDED]">
                <span className="text-base font-semibold text-[#333]">{t.invoices.total}</span>
                <span className="text-xl font-bold text-[#333]">{fmtCurrency(subtotal, currency)}</span>
              </div>
              <div className="mt-4">
                <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.memo}</label>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="Detalles adicionales para el cliente..." className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.invoiceDetails}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">Numero de factura, fechas y referencia.</p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.invoiceNumber}</label><input type="text" value={invNumber} readOnly className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] bg-[#F6F6F6] font-mono" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.poNumber}</label><input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-12345" className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.invoiceDate}</label><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.dueDate}</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
              <div className="mb-4">
                <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.currency}</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
                  <option value="USD">USD - Dolar americano</option><option value="COP">COP - Peso colombiano</option><option value="EUR">EUR - Euro</option><option value="MXN">MXN - Peso mexicano</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.internalNote}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Solo visible para el equipo..." className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none" /></div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.reviewAndSend}</h2>
              <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-[#F6F6F6]">
                <div><p className="text-xs text-[#8B8B8B]">{t.invoices.invoiceTo}</p><p className="text-sm font-semibold text-[#333]">{orgName}</p></div>
                {dueDate && <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-[#EDEDED]"><svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span className="text-xs font-medium text-[#585858]">Vence {fmtDateLong(dueDate)}</span></div>}
              </div>
              <div className="text-3xl font-bold text-[#333] mb-6">{fmtCurrency(subtotal, currency)}</div>
              <div className="space-y-4">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.emailTo}</label><input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={orgEmail || 'email@empresa.com'} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.cc}</label><input type="text" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@empresa.com" className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
            </div>
          )}
        </div>

        {/* Right — Live Preview */}
        <div className="w-1/2 overflow-y-auto bg-[#F0F0F0] p-6">
          {step > 0 && (
            <>
              <div className="flex gap-4 mb-4">
                <button onClick={() => setPreviewTab('invoice')} className={`text-sm font-medium pb-1 ${previewTab === 'invoice' ? 'text-[#333] border-b-2 border-[#333]' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>Factura</button>
                <button onClick={() => setPreviewTab('email')} className={`text-sm font-medium pb-1 ${previewTab === 'email' ? 'text-[#333] border-b-2 border-[#333]' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>Email</button>
              </div>

              {previewTab === 'invoice' && (
                <div className="bg-white rounded-xl shadow-lg p-8 min-h-[600px]">
                  <div className="flex justify-between items-start mb-8">
                    <h3 className="text-2xl font-bold text-[#333]">Invoice</h3>
                    <div className="w-10 h-10 rounded-lg bg-[#DD0C15] flex items-center justify-center"><span className="text-white text-sm font-bold">T</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-8 text-xs">
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">From</p><p className="font-semibold text-[#333]">NEXA DEV LLC</p><p className="text-[#585858]">federico@nexadev.ai</p><p className="text-[#585858] mt-1">2 South Biscayne Boulevard<br />Ste 3200-5640<br />Miami, FL 33131</p></div>
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">To</p><p className="font-semibold text-[#333]">{orgName || '...'}</p><p className="text-[#585858]">{emailTo || orgEmail || '...'}</p></div>
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">Details</p><table className="text-[11px]"><tbody><tr><td className="text-[#8B8B8B] pr-2">Invoice no.</td><td className="font-semibold">{invNumber}</td></tr>{poNumber && <tr><td className="text-[#8B8B8B] pr-2">PO no.</td><td className="font-semibold">{poNumber}</td></tr>}</tbody></table></div>
                  </div>
                  {/* Line items table */}
                  <table className="w-full text-xs mb-4">
                    <thead><tr className="border-b border-[#EDEDED]"><th className="text-left py-2 text-[#8B8B8B] font-medium">Item</th><th className="text-center py-2 text-[#8B8B8B] font-medium">Quantity</th><th className="text-right py-2 text-[#8B8B8B] font-medium">Unit price</th><th className="text-right py-2 text-[#8B8B8B] font-medium">Total</th></tr></thead>
                    <tbody>
                      {lineItems.filter(li => li.description).map((li, i) => (
                        <tr key={i} className="border-b border-[#F6F6F6]"><td className="py-2 text-[#333]">{li.description}</td><td className="py-2 text-center text-[#585858]">{li.quantity}</td><td className="py-2 text-right text-[#585858]">${li.unitPrice.toFixed(2)}</td><td className="py-2 text-right font-semibold text-[#333]">${(li.quantity * li.unitPrice).toFixed(2)}</td></tr>
                      ))}
                      {lineItems.filter(li => li.description).length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[#8B8B8B]">Agrega items en el formulario</td></tr>}
                    </tbody>
                  </table>
                  <div className="flex justify-end"><div className="text-right"><span className="text-sm font-bold text-[#333]">Total</span><span className="text-lg font-bold text-[#333] ml-4">{fmtCurrency(subtotal, currency)}</span></div></div>
                  {/* Terms */}
                  <div className="grid grid-cols-2 gap-4 mt-8 pt-4 border-t border-[#EDEDED] text-xs">
                    <div><p className="text-[#8B8B8B] font-medium mb-1">Terms</p><table><tbody><tr><td className="text-[#8B8B8B] pr-2">Invoice date</td><td className="font-medium">{invoiceDate ? fmtDateLong(invoiceDate) : '\u2014'}</td></tr><tr><td className="text-[#8B8B8B] pr-2">Due date</td><td className="font-medium">{dueDate ? fmtDateLong(dueDate) : '\u2014'}</td></tr></tbody></table></div>
                    {memo && <div><p className="text-[#8B8B8B] font-medium mb-1">Memo</p><p className="text-[#585858]">{memo}</p></div>}
                  </div>
                </div>
              )}

              {previewTab === 'email' && (
                <div className="bg-white rounded-xl shadow-lg p-6 min-h-[600px]">
                  <div className="flex items-center gap-1.5 mb-4"><svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span className="text-xs font-medium text-[#585858]">Enviar hoy</span></div>
                  <div className="bg-[#1a1a2e] rounded-xl p-6 text-white">
                    <div className="space-y-3 text-xs mb-6">
                      <div className="flex"><span className="text-white/50 w-24">Subject:</span><span>NEXA DEV LLC te envio una nueva factura</span></div>
                      <div className="flex"><span className="text-white/50 w-24">Preview Text:</span><span>Revisa y paga tu factura</span></div>
                      <div className="flex"><span className="text-white/50 w-24">To:</span><span className="bg-[#1F114C] px-2 py-0.5 rounded">{emailTo || orgEmail || '...'}</span></div>
                      <div className="flex"><span className="text-white/50 w-24">From:</span><span>TIMS ATS &lt;noreply@nexadev.ai&gt;</span></div>
                    </div>
                    <div className="bg-[#0f0f23] rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-[#DD0C15] flex items-center justify-center"><span className="text-white text-[10px] font-bold">T</span></div><span className="text-sm font-semibold">TIMS ATS</span></div>
                      <h3 className="text-lg font-bold mb-4">Te han enviado una nueva factura</h3>
                      <p className="text-sm text-white/70 mb-6">NEXA DEV LLC te envio la factura {invNumber}{dueDate ? ` con vencimiento el ${fmtDateLong(dueDate)}` : ''} por {fmtCurrency(subtotal, currency)}.</p>
                      <div className="bg-[#1a1a3e] rounded-lg p-4 flex justify-between items-center mb-4">
                        <div><span className="text-2xl font-bold">{fmtCurrency(subtotal, currency)}</span>{dueDate && <p className="text-xs text-white/50 mt-1">Vence {fmtDateLong(dueDate)}</p>}</div>
                        <span className="text-sm font-semibold text-white/60">{invNumber}</span>
                      </div>
                      <button className="w-full bg-[#1F114C] text-white py-3 rounded-lg font-semibold text-sm">Pagar Factura</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {step === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-[#8B8B8B]"><svg className="w-16 h-16 mx-auto mb-3 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg><p className="text-sm">Selecciona un cliente para ver la vista previa</p></div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-center gap-3 px-6 py-4 bg-white border-t border-[#EDEDED] flex-shrink-0">
        {step > 0 && <button onClick={() => setStep(step - 1)} className="h-10 px-5 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition flex items-center gap-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>{t.invoices.back}</button>}
        {step < 3 && <button onClick={() => setStep(step + 1)} disabled={!canNext()} className="h-10 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-40 flex items-center gap-1.5">{t.invoices.next}<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>}
        {step === 3 && <>
          <button onClick={() => handleSubmit(false)} disabled={createInvoice.isPending} className="h-10 px-5 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">{t.invoices.createOnly}</button>
          <button onClick={() => handleSubmit(true)} disabled={createInvoice.isPending} className="h-10 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50 flex items-center gap-1.5">{createInvoice.isPending ? t.invoices.creating : t.invoices.createAndSend}<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>
        </>}
      </div>
    </div>
  );
}

// ===========================
// INVOICE DETAIL VIEW
// ===========================

function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const invoice = trpc.platform.getInvoice.useQuery({ id });
  const utils = trpc.useUtils();
  const updateStatus = trpc.platform.updateInvoiceStatus.useMutation({
    onSuccess: () => { invoice.refetch(); utils.platform.listInvoices.invalidate(); utils.platform.getInvoiceKpis.invalidate(); toast('Estado de factura actualizado', { type: 'success' }); },
    onError: (err) => { toast(err.message || 'Error al actualizar estado', { type: 'error' }); },
  });
  const sendReminder = trpc.platform.sendPaymentReminder.useMutation({
    onSuccess: () => { toast('Recordatorio de pago enviado', { type: 'success' }); },
    onError: (err) => { toast(err.message || 'Error al enviar recordatorio', { type: 'error' }); },
  });

  if (invoice.isLoading) return <div className="h-full flex items-center justify-center"><div className="text-center"><Skeleton className="h-8 w-32 mb-4 mx-auto" /><Skeleton className="h-4 w-48 mx-auto" /></div></div>;
  if (!invoice.data) return <div className="h-full flex items-center justify-center"><p className="text-[#8B8B8B]">Factura no encontrada</p></div>;

  const inv = invoice.data;
  const isVoid = inv.status === 'void';
  const isPaid = inv.status === 'paid';
  const isOverdue = inv.status === 'pending' && inv.dueDate && new Date(inv.dueDate) < new Date();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#EDEDED] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg></button>
          <div><h1 className="text-lg font-semibold text-[#333]">INV-{inv.invoiceNumber}</h1><p className="text-xs text-[#8B8B8B]">{inv.organization.name}</p></div>
          <div className="ml-2">{statusBadge(inv.status, inv.dueDate, { draft: t.invoices.statusDraft, pending: t.invoices.statusPending, paid: t.invoices.statusPaid, void: t.invoices.statusVoid, overdue: t.invoices.statusOverdue })}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isPaid && !isVoid && <>
            <button onClick={() => sendReminder.mutate({ id: inv.id })} disabled={sendReminder.isPending} className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">Enviar Recordatorio</button>
            <button onClick={() => { if (confirm('Marcar como pagada?')) updateStatus.mutate({ id: inv.id, status: 'paid' }); }} disabled={updateStatus.isPending} className="h-8 px-4 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition disabled:opacity-50">Marcar Pagada</button>
          </>}
          {isPaid && <button onClick={() => { if (confirm('Revertir a pendiente?')) updateStatus.mutate({ id: inv.id, status: 'pending' }); }} disabled={updateStatus.isPending} className="h-8 px-3 rounded-lg border border-amber-300 text-xs font-medium text-amber-700 hover:bg-amber-50 transition disabled:opacity-50">Revertir</button>}
          {!isVoid && <button onClick={() => { if (confirm('Anular factura?')) updateStatus.mutate({ id: inv.id, status: 'void' }); }} disabled={updateStatus.isPending} className="h-8 px-3 rounded-lg border border-red-200 text-xs font-medium text-[#DD0C15] hover:bg-red-50 transition disabled:opacity-50">Anular</button>}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[#F0F0F0] flex justify-center p-8">
        <div className="bg-white rounded-xl shadow-lg p-10 w-full max-w-[700px] min-h-[700px]">
          <div className="flex justify-between items-start mb-10">
            <h3 className="text-3xl font-bold text-[#333]">Invoice</h3>
            <div className="w-12 h-12 rounded-lg bg-[#DD0C15] flex items-center justify-center"><span className="text-white text-lg font-bold">T</span></div>
          </div>
          <div className="grid grid-cols-3 gap-6 mb-10 text-sm">
            <div><p className="text-[#8B8B8B] text-xs mb-1 font-medium">From</p><p className="font-semibold text-[#333]">NEXA DEV LLC</p><p className="text-[#585858] text-xs">federico@nexadev.ai</p><p className="text-[#585858] text-xs mt-1">2 South Biscayne Boulevard<br />Ste 3200-5640<br />Miami, FL 33131</p></div>
            <div><p className="text-[#8B8B8B] text-xs mb-1 font-medium">To</p><p className="font-semibold text-[#333]">{inv.organization.name}</p><p className="text-[#585858] text-xs">{inv.emailTo || inv.organization.billingEmail || '\u2014'}</p>
              {inv.organization.billingProfile && <p className="text-[#585858] text-xs mt-1">{[inv.organization.billingProfile.address, inv.organization.billingProfile.city, inv.organization.billingProfile.state, inv.organization.billingProfile.country].filter(Boolean).join(', ')}</p>}
            </div>
            <div><p className="text-[#8B8B8B] text-xs mb-1 font-medium">Details</p><table className="text-xs"><tbody><tr><td className="text-[#8B8B8B] pr-3 py-0.5">Invoice no.</td><td className="font-semibold">INV-{inv.invoiceNumber}</td></tr>{inv.poNumber && <tr><td className="text-[#8B8B8B] pr-3 py-0.5">PO no.</td><td className="font-semibold">{inv.poNumber}</td></tr>}</tbody></table></div>
          </div>
          {/* Line items */}
          <table className="w-full text-sm mb-6">
            <thead><tr className="border-b-2 border-[#EDEDED]"><th className="text-left py-2 text-[#8B8B8B] text-xs font-medium">Item</th><th className="text-center py-2 text-[#8B8B8B] text-xs font-medium">Quantity</th><th className="text-right py-2 text-[#8B8B8B] text-xs font-medium">Unit price</th><th className="text-right py-2 text-[#8B8B8B] text-xs font-medium">Total</th></tr></thead>
            <tbody>
              {inv.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-[#F6F6F6]"><td className="py-3 text-[#333]">{li.description}</td><td className="py-3 text-center text-[#585858]">{li.quantity}</td><td className="py-3 text-right text-[#585858]">{fmtCurrency(li.unitPrice, inv.currency)}</td><td className="py-3 text-right font-semibold text-[#333]">{fmtCurrency(li.total, inv.currency)}</td></tr>
              ))}
              {inv.lineItems.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[#8B8B8B] text-xs">Sin items</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-end mb-8"><div className="text-right"><span className="text-base font-semibold text-[#333]">{t.invoices.total}</span><span className="text-2xl font-bold text-[#333] ml-6">{fmtCurrency(inv.amount, inv.currency)}</span></div></div>
          {/* Terms */}
          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-[#EDEDED] text-sm">
            <div><p className="text-[#8B8B8B] text-xs font-medium mb-2">Terms</p><table className="text-xs"><tbody><tr><td className="text-[#8B8B8B] pr-3 py-0.5">Invoice date</td><td className="font-medium">{fmtDateLong(inv.invoiceDate)}</td></tr><tr><td className="text-[#8B8B8B] pr-3 py-0.5">Due date</td><td className={`font-medium ${isOverdue ? 'text-[#DD0C15]' : ''}`}>{fmtDateLong(inv.dueDate)}</td></tr>{isPaid && <tr><td className="text-[#8B8B8B] pr-3 py-0.5">Paid on</td><td className="font-medium text-green-600">{fmtDateLong(inv.paidAt)}</td></tr>}</tbody></table></div>
            {inv.memo && <div><p className="text-[#8B8B8B] text-xs font-medium mb-2">Memo</p><p className="text-xs text-[#585858]">{inv.memo}</p></div>}
          </div>
          {inv.notes && <div className="mt-6 p-3 bg-amber-50 rounded-lg text-xs text-amber-700"><strong>Nota interna:</strong> {inv.notes}</div>}
        </div>
      </div>
    </div>
  );
}

// ===========================
// BILLING PROFILE DRAWER
// ===========================

function BillingProfileDrawer({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const { t } = useI18n();
  const profile = trpc.platform.getBillingProfile.useQuery({ organizationId });
  const upsert = trpc.platform.upsertBillingProfile.useMutation({
    onSuccess: () => { toast('Perfil de facturacion actualizado', { type: 'success' }); onClose(); },
    onError: (err) => { toast(err.message || 'Error al actualizar perfil de facturacion', { type: 'error' }); },
  });
  const [form, setForm] = useState({ companyName: '', taxId: '', address: '', city: '', state: '', country: '', zipCode: '', billingEmail: '', billingPhone: '' });
  const [initialized, setInitialized] = useState(false);
  if (profile.data && !initialized) { setForm({ companyName: profile.data.companyName || '', taxId: profile.data.taxId || '', address: profile.data.address || '', city: profile.data.city || '', state: profile.data.state || '', country: profile.data.country || '', zipCode: profile.data.zipCode || '', billingEmail: profile.data.billingEmail || '', billingPhone: profile.data.billingPhone || '' }); setInitialized(true); }
  if (!profile.data && profile.isFetched && !initialized) setInitialized(true);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); upsert.mutate({ organizationId, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined])) } as Parameters<typeof upsert.mutate>[0]); };
  const fields: Array<{ key: keyof typeof form; label: string; type?: string; span?: number }> = [
    { key: 'companyName', label: t.invoices.companyName, span: 2 }, { key: 'taxId', label: t.invoices.taxId }, { key: 'billingEmail', label: t.invoices.billingEmail, type: 'email' }, { key: 'billingPhone', label: t.invoices.phone }, { key: 'address', label: t.invoices.address, span: 2 }, { key: 'city', label: t.invoices.city }, { key: 'state', label: t.invoices.state }, { key: 'country', label: t.invoices.country }, { key: 'zipCode', label: t.invoices.zipCode },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end"><div className="absolute inset-0 bg-black/40" onClick={onClose} /><div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-xl">
      <div className="flex items-center justify-between p-5 border-b border-[#EDEDED] sticky top-0 bg-white z-10"><h2 className="text-base font-semibold text-[#333]">{t.invoices.billingProfile}</h2><button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button></div>
      {profile.isLoading ? <div className="p-5 space-y-4">{Array.from({ length: 6 }).map((_, i) => <div key={i}><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-9 w-full" /></div>)}</div> : (
        <form onSubmit={handleSubmit} className="p-5"><div className="grid grid-cols-2 gap-3">{fields.map((f) => (<div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}><label className="text-xs font-medium text-[#585858] mb-1 block">{f.label}</label><input type={f.type || 'text'} value={form[f.key]} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>))}</div>
        <div className="flex justify-end gap-2 mt-6"><button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.invoices.cancel}</button><button type="submit" disabled={upsert.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">{upsert.isPending ? t.invoices.saving : t.invoices.save}</button></div></form>
      )}
    </div></div>
  );
}
