'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatDateLong } from '../../../../lib/format-utils';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, EmptyState, ErrorState, Skeleton } from '../../../../components';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { ConfirmModal } from './confirm-modal';

export function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const invoice = trpc.platform.getInvoice.useQuery({ id });
  const utils = trpc.useUtils();
  const [confirmAction, setConfirmAction] = useState<'paid' | 'void' | 'pending' | null>(null);

  const updateStatus = trpc.platform.updateInvoiceStatus.useMutation({
    onSuccess: (_data, vars) => {
      invoice.refetch();
      utils.platform.listInvoices.invalidate();
      utils.platform.getInvoiceKpis.invalidate();
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

  const iv = t.invoices;
  const backButton = (
    <button type="button" onClick={onBack} className="mb-0.5 inline-flex items-center gap-1 text-callout text-secondary transition-colors hover:text-brand pointer-coarse:min-h-11">
      <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
      {iv.backToInvoices}
    </button>
  );

  if (invoice.isLoading) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <div className="text-center" aria-hidden="true"><Skeleton className="mx-auto mb-4 h-8 w-32" /><Skeleton className="mx-auto h-4 w-48" /></div>
      </div>
    );
  }
  if (invoice.isError) {
    return <div className="flex h-full flex-col p-4">{backButton}<ErrorState className="flex-1" title={iv.loadError} onRetry={() => invoice.refetch()} error={invoice.error} /></div>;
  }
  if (!invoice.data) {
    return <div className="flex h-full flex-col p-4">{backButton}<EmptyState className="flex-1" title={iv.notFound} description={t.common.notFoundHint} /></div>;
  }

  const inv = invoice.data;
  const isVoid = inv.status === 'void';
  const isPaid = inv.status === 'paid';
  const isOverdue = inv.status === 'pending' && inv.dueDate && new Date(inv.dueDate) < new Date();
  const n = inv.invoiceNumber;

  const confirmMeta = confirmAction ? {
    paid: { title: formatMessage(iv.confirmMarkPaidTitle, { n }), message: iv.confirmMarkPaidBody, label: iv.markPaidConfirm, destructive: false },
    pending: { title: formatMessage(iv.confirmRevertTitle, { n }), message: iv.confirmRevertBody, label: iv.revertConfirm, destructive: false },
    void: { title: formatMessage(iv.confirmVoidTitle, { n }), message: iv.confirmVoidBody, label: iv.voidConfirm, destructive: true },
  }[confirmAction] : null;
  const LABEL = 'mb-1 text-callout font-medium text-secondary';

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-white px-4 py-3 md:px-6">
        {backButton}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-title font-semibold text-brand">INV-{n}</h1>
              <InvoiceStatusBadge status={inv.status} dueDate={inv.dueDate} />
            </div>
            <p className="text-callout text-secondary">{inv.organization.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isVoid && (
              <Button variant="destructive-secondary" onClick={() => setConfirmAction('void')}>{iv.voidEllipsis}</Button>
            )}
            {isPaid && <Button variant="secondary" onClick={() => setConfirmAction('pending')}>{iv.revertEllipsis}</Button>}
            {!isPaid && !isVoid && (
              <>
                <Button variant="secondary" onClick={() => sendReminder.mutate({ id: inv.id })} loading={sendReminder.isPending}>{iv.sendReminderBtn}</Button>
                <Button onClick={() => setConfirmAction('paid')}>{iv.markPaidEllipsis}</Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Body: the invoice document */}
      <div className="flex flex-1 justify-center overflow-y-auto bg-surface p-3 md:p-8">
        <article className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-card md:min-h-[700px] md:p-10" aria-label={formatMessage(iv.docLabel, { n })}>
          <h2 className="mb-6 font-display text-display font-semibold text-primary md:mb-10">{iv.docTitle}</h2>
          <div className="mb-8 grid grid-cols-1 gap-4 text-body sm:grid-cols-3 sm:gap-6 md:mb-10">
            <div>
              <p className={LABEL}>{iv.docFrom}</p>
              <p className="font-semibold text-primary">{iv.fromCompanyName}</p>
              <p className="break-all text-callout text-secondary">{iv.fromEmail}</p>
              <p className="mt-1 text-callout text-secondary">{iv.fromAddress1}<br />{iv.fromAddress2}<br />{iv.fromCity}</p>
            </div>
            <div>
              <p className={LABEL}>{iv.docTo}</p>
              <p className="font-semibold text-primary">{inv.organization.name}</p>
              <p className="break-all text-callout text-secondary">{inv.emailTo || inv.organization.billingEmail || '\u2014'}</p>
              {inv.organization.billingProfile && (
                <p className="mt-1 text-callout text-secondary">
                  {[inv.organization.billingProfile.address, inv.organization.billingProfile.city, inv.organization.billingProfile.state, inv.organization.billingProfile.country].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <div>
              <p className={LABEL}>{iv.docDetails}</p>
              <dl className="text-callout">
                <div className="flex gap-3 py-0.5"><dt className="text-secondary">{iv.colInvoiceNo}</dt><dd className="font-semibold text-primary">INV-{n}</dd></div>
                {inv.poNumber && <div className="flex gap-3 py-0.5"><dt className="text-secondary">{iv.colPoNo}</dt><dd className="font-semibold text-primary">{inv.poNumber}</dd></div>}
              </dl>
            </div>
          </div>
          {/* Line items: stacked rows on phones, a table from sm */}
          <ul className="mb-6 divide-y divide-border border-y border-border sm:hidden">
            {inv.lineItems.map((li) => (
              <li key={li.id} className="py-3">
                <p className="text-body text-primary">{li.description}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-callout tabular-nums">
                  <span className="text-secondary">{li.quantity} × {formatCurrency(li.unitPrice, inv.currency, 2)}</span>
                  <span className="font-semibold text-primary">{formatCurrency(li.total, inv.currency, 2)}</span>
                </div>
              </li>
            ))}
            {inv.lineItems.length === 0 && <li className="py-4 text-center text-callout text-secondary">{iv.noLineItems}</li>}
          </ul>
          <table className="mb-6 hidden w-full text-body sm:table">
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="py-2 text-left text-callout font-medium text-secondary">{iv.item}</th>
                <th scope="col" className="py-2 text-center text-callout font-medium text-secondary">{iv.quantity}</th>
                <th scope="col" className="py-2 text-right text-callout font-medium text-secondary">{iv.unitPrice}</th>
                <th scope="col" className="py-2 text-right text-callout font-medium text-secondary">{iv.total}</th>
              </tr>
            </thead>
            <tbody>
              {inv.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-border">
                  <td className="py-3 text-primary">{li.description}</td>
                  <td className="py-3 text-center tabular-nums text-secondary">{li.quantity}</td>
                  <td className="py-3 text-right tabular-nums text-secondary">{formatCurrency(li.unitPrice, inv.currency, 2)}</td>
                  <td className="py-3 text-right font-semibold tabular-nums text-primary">{formatCurrency(li.total, inv.currency, 2)}</td>
                </tr>
              ))}
              {inv.lineItems.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-callout text-secondary">{iv.noLineItems}</td></tr>
              )}
            </tbody>
          </table>
          <div className="mb-8 flex justify-end">
            <p className="flex flex-wrap items-baseline justify-end gap-x-6 text-right">
              <span className="text-subheading font-semibold text-primary">{iv.total}</span>
              <span className={`text-2xl font-semibold tabular-nums ${isVoid ? 'text-muted line-through' : 'text-primary'}`}>{formatCurrency(inv.amount, inv.currency, 2)}</span>
            </p>
          </div>
          {/* Terms */}
          <div className="grid grid-cols-1 gap-6 border-t border-border pt-6 text-body sm:grid-cols-2">
            <div>
              <p className={LABEL}>{iv.docTerms}</p>
              <dl className="text-callout">
                <div className="flex gap-3 py-0.5"><dt className="text-secondary">{iv.invoiceDate}</dt><dd className="font-medium text-primary">{formatDateLong(inv.invoiceDate)}</dd></div>
                <div className="flex gap-3 py-0.5"><dt className="text-secondary">{iv.dueDate}</dt><dd className={`font-medium ${isOverdue ? 'text-danger' : 'text-primary'}`}>{formatDateLong(inv.dueDate)}</dd></div>
                {isPaid && <div className="flex gap-3 py-0.5"><dt className="text-secondary">{iv.paidOn}</dt><dd className="font-medium text-success">{formatDateLong(inv.paidAt)}</dd></div>}
              </dl>
            </div>
            {inv.memo && <div><p className={LABEL}>{iv.memo}</p><p className="text-callout text-primary">{inv.memo}</p></div>}
          </div>
          {inv.notes && (
            <p className="mt-6 rounded-lg bg-warning-bg p-3 text-callout text-warning">
              <strong>{iv.internalNoteLabel}:</strong> {inv.notes}
            </p>
          )}
        </article>
      </div>

      {/* Confirm Modal */}
      {confirmAction && confirmMeta && (
        <ConfirmModal
          title={confirmMeta.title}
          message={confirmMeta.message}
          confirmLabel={confirmMeta.label}
          destructive={confirmMeta.destructive}
          onConfirm={() => updateStatus.mutate({ id: inv.id, status: confirmAction })}
          onClose={() => setConfirmAction(null)}
          isPending={updateStatus.isPending}
        />
      )}
    </div>
  );
}
