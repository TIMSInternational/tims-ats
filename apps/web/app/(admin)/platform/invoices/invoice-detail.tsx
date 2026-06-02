'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatDateLong } from '../../../../lib/format-utils';
import { Skeleton } from '../../../../components';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { ConfirmModal } from './confirm-modal';

export function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const invoice = trpc.platform.getInvoice.useQuery({ id });
  const utils = trpc.useUtils();
  const [confirmAction, setConfirmAction] = useState<'paid' | 'void' | 'pending' | null>(null);

  const updateStatus = trpc.platform.updateInvoiceStatus.useMutation({
    onSuccess: () => {
      invoice.refetch();
      utils.platform.listInvoices.invalidate();
      utils.platform.getInvoiceKpis.invalidate();
      setConfirmAction(null);
      toast(t.invoices.statusUpdated, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const sendReminder = trpc.platform.sendPaymentReminder.useMutation({
    onSuccess: () => { toast(t.invoices.reminderSent, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  if (invoice.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center"><Skeleton className="h-8 w-32 mb-4 mx-auto" /><Skeleton className="h-4 w-48 mx-auto" /></div>
      </div>
    );
  }
  if (!invoice.data) {
    return <div className="h-full flex items-center justify-center"><p className="text-[#8B8B8B]">{t.invoices.notFound}</p></div>;
  }

  const inv = invoice.data;
  const isVoid = inv.status === 'void';
  const isPaid = inv.status === 'paid';
  const isOverdue = inv.status === 'pending' && inv.dueDate && new Date(inv.dueDate) < new Date();

  const confirmMeta = confirmAction ? {
    paid: { title: t.invoices.markPaid, message: t.invoices.confirmMarkPaid, label: t.invoices.markPaidBtn, color: 'bg-green-600 hover:bg-green-700' },
    pending: { title: t.invoices.revert, message: t.invoices.confirmRevert, label: t.invoices.revertBtn, color: 'bg-amber-600 hover:bg-amber-700' },
    void: { title: t.invoices.void, message: t.invoices.confirmVoid, label: t.invoices.voidBtn, color: 'bg-[#DD0C15] hover:bg-red-700' },
  }[confirmAction] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#EDEDED] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-[#333]">INV-{inv.invoiceNumber}</h1>
            <p className="text-xs text-[#8B8B8B]">{inv.organization.name}</p>
          </div>
          <div className="ml-2"><InvoiceStatusBadge status={inv.status} dueDate={inv.dueDate} /></div>
        </div>
        <div className="flex items-center gap-2">
          {!isPaid && !isVoid && (
            <>
              <button onClick={() => sendReminder.mutate({ id: inv.id })} disabled={sendReminder.isPending} className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">{t.invoices.sendReminderBtn}</button>
              <button onClick={() => setConfirmAction('paid')} className="h-8 px-4 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition">{t.invoices.markPaidBtn}</button>
            </>
          )}
          {isPaid && <button onClick={() => setConfirmAction('pending')} className="h-8 px-3 rounded-lg border border-amber-300 text-xs font-medium text-amber-700 hover:bg-amber-50 transition">{t.invoices.revertBtn}</button>}
          {!isVoid && <button onClick={() => setConfirmAction('void')} className="h-8 px-3 rounded-lg border border-red-200 text-xs font-medium text-[#DD0C15] hover:bg-red-50 transition">{t.invoices.voidBtn}</button>}
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
            <div>
              <p className="text-[#8B8B8B] text-xs mb-1 font-medium">From</p>
              <p className="font-semibold text-[#333]">NEXA DEV LLC</p>
              <p className="text-[#585858] text-xs">federico@nexadev.ai</p>
              <p className="text-[#585858] text-xs mt-1">2 South Biscayne Boulevard<br />Ste 3200-5640<br />Miami, FL 33131</p>
            </div>
            <div>
              <p className="text-[#8B8B8B] text-xs mb-1 font-medium">To</p>
              <p className="font-semibold text-[#333]">{inv.organization.name}</p>
              <p className="text-[#585858] text-xs">{inv.emailTo || inv.organization.billingEmail || '\u2014'}</p>
              {inv.organization.billingProfile && (
                <p className="text-[#585858] text-xs mt-1">
                  {[inv.organization.billingProfile.address, inv.organization.billingProfile.city, inv.organization.billingProfile.state, inv.organization.billingProfile.country].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <div>
              <p className="text-[#8B8B8B] text-xs mb-1 font-medium">Details</p>
              <table className="text-xs"><tbody>
                <tr><td className="text-[#8B8B8B] pr-3 py-0.5">Invoice no.</td><td className="font-semibold">INV-{inv.invoiceNumber}</td></tr>
                {inv.poNumber && <tr><td className="text-[#8B8B8B] pr-3 py-0.5">PO no.</td><td className="font-semibold">{inv.poNumber}</td></tr>}
              </tbody></table>
            </div>
          </div>
          {/* Line items */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-[#EDEDED]">
                <th className="text-left py-2 text-[#8B8B8B] text-xs font-medium">{t.invoices.item}</th>
                <th className="text-center py-2 text-[#8B8B8B] text-xs font-medium">{t.invoices.quantity}</th>
                <th className="text-right py-2 text-[#8B8B8B] text-xs font-medium">{t.invoices.unitPrice}</th>
                <th className="text-right py-2 text-[#8B8B8B] text-xs font-medium">{t.invoices.total}</th>
              </tr>
            </thead>
            <tbody>
              {inv.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-[#F6F6F6]">
                  <td className="py-3 text-[#333]">{li.description}</td>
                  <td className="py-3 text-center text-[#585858]">{li.quantity}</td>
                  <td className="py-3 text-right text-[#585858]">{formatCurrency(li.unitPrice, inv.currency, 2)}</td>
                  <td className="py-3 text-right font-semibold text-[#333]">{formatCurrency(li.total, inv.currency, 2)}</td>
                </tr>
              ))}
              {inv.lineItems.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-[#8B8B8B] text-xs">Sin items</td></tr>
              )}
            </tbody>
          </table>
          <div className="flex justify-end mb-8">
            <div className="text-right">
              <span className="text-base font-semibold text-[#333]">{t.invoices.total}</span>
              <span className="text-2xl font-bold text-[#333] ml-6">{formatCurrency(inv.amount, inv.currency, 2)}</span>
            </div>
          </div>
          {/* Terms */}
          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-[#EDEDED] text-sm">
            <div>
              <p className="text-[#8B8B8B] text-xs font-medium mb-2">Terms</p>
              <table className="text-xs"><tbody>
                <tr><td className="text-[#8B8B8B] pr-3 py-0.5">{t.invoices.invoiceDate}</td><td className="font-medium">{formatDateLong(inv.invoiceDate)}</td></tr>
                <tr><td className="text-[#8B8B8B] pr-3 py-0.5">{t.invoices.dueDate}</td><td className={`font-medium ${isOverdue ? 'text-[#DD0C15]' : ''}`}>{formatDateLong(inv.dueDate)}</td></tr>
                {isPaid && <tr><td className="text-[#8B8B8B] pr-3 py-0.5">{t.invoices.markPaid}</td><td className="font-medium text-green-600">{formatDateLong(inv.paidAt)}</td></tr>}
              </tbody></table>
            </div>
            {inv.memo && <div><p className="text-[#8B8B8B] text-xs font-medium mb-2">{t.invoices.memo}</p><p className="text-xs text-[#585858]">{inv.memo}</p></div>}
          </div>
          {inv.notes && (
            <div className="mt-6 p-3 bg-amber-50 rounded-lg text-xs text-amber-700">
              <strong>{t.invoices.internalNoteLabel}:</strong> {inv.notes}
            </div>
          )}
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmAction && confirmMeta && (
        <ConfirmModal
          title={confirmMeta.title}
          message={confirmMeta.message}
          confirmLabel={confirmMeta.label}
          confirmColor={confirmMeta.color}
          onConfirm={() => updateStatus.mutate({ id: inv.id, status: confirmAction })}
          onClose={() => setConfirmAction(null)}
          isPending={updateStatus.isPending}
        />
      )}
    </div>
  );
}
