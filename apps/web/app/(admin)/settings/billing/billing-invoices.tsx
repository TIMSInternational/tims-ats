'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { useBillingInvoices, useBillingInvoice } from '../../../../lib/platform-api/billing';
import { formatCurrency, formatDate } from '../../../../lib/format-utils';
import { DataTable, Drawer, EmptyState, ErrorState, StatusBadge } from '../../../../components';

type T = ReturnType<typeof useI18n>['t'];

function invoiceStatusMap(t: T): Record<string, { cls: string; label: string }> {
  return {
    draft: { cls: 'bg-gray-100 text-gray-600', label: t.billing.invoiceStatusDraft },
    pending: { cls: 'bg-amber-100 text-amber-700', label: t.billing.invoiceStatusPending },
    paid: { cls: 'bg-green-100 text-green-700', label: t.billing.invoiceStatusPaid },
    void: { cls: 'bg-red-100 text-red-700', label: t.billing.invoiceStatusVoid },
  };
}

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const invoice = useBillingInvoice(id);

  return (
    <Drawer
      title={invoice.data ? `${t.billing.invoiceNumber} INV-${invoice.data.invoiceNumber}` : t.billing.invoiceNumber}
      onClose={onClose}
    >
      {invoice.isError ? (
        <ErrorState onRetry={() => invoice.refetch()} />
      ) : invoice.isLoading || !invoice.data ? (
        <p className="text-[13px] text-[#8B8B8B]">{t.common.loading}</p>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColAmount}</span>
            <span className="font-semibold text-[#1F114C]">
              {formatCurrency(invoice.data.amount, invoice.data.currency, 2)}
            </span>
          </div>
          {invoice.data.subtotal != null && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceSubtotal}</span>
              <span className="text-[#333]">{formatCurrency(invoice.data.subtotal, invoice.data.currency, 2)}</span>
            </div>
          )}
          {invoice.data.taxRate != null && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceTax}</span>
              <span className="text-[#333]">{invoice.data.taxRate}%</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColStatus}</span>
            <StatusBadge status={invoice.data.status} map={invoiceStatusMap(t)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColDate}</span>
            <span className="text-[#333]">{formatDate(invoice.data.invoiceDate)}</span>
          </div>
          {invoice.data.dueDate && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceDueDate}</span>
              <span className="text-[#333]">{formatDate(invoice.data.dueDate)}</span>
            </div>
          )}
          {(invoice.data.periodStart || invoice.data.periodEnd) && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoicePeriod}</span>
              <span className="text-[#333]">
                {formatDate(invoice.data.periodStart)} - {formatDate(invoice.data.periodEnd)}
              </span>
            </div>
          )}
          {invoice.data.poNumber && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoicePoNumber}</span>
              <span className="text-[#333]">{invoice.data.poNumber}</span>
            </div>
          )}
          {invoice.data.notes && (
            <div>
              <span className="text-[#8B8B8B] block mb-1">{t.billing.invoiceNotes}</span>
              <p className="text-[#333] whitespace-pre-wrap">{invoice.data.notes}</p>
            </div>
          )}
          {invoice.data.invoiceUrl && (
            <a
              href={invoice.data.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 h-9 inline-flex items-center justify-center rounded-lg border border-[#EDEDED] text-[#1F114C] text-[12px] font-medium hover:bg-[#F6F6F6] transition"
            >
              {t.billing.invoiceDownload}
            </a>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function BillingInvoices() {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const invoices = useBillingInvoices();

  const rows = invoices.data?.pages.flatMap((p) => p.items) ?? [];
  const statusMap = invoiceStatusMap(t);

  const columns = [
    { key: 'date', label: t.billing.invoiceColDate },
    { key: 'amount', label: t.billing.invoiceColAmount, align: 'right' as const },
    { key: 'status', label: t.billing.invoiceColStatus, align: 'center' as const },
  ];

  const emptyIcon = (
    <svg className="w-10 h-10 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  return (
    <div className="bg-white border border-[#EDEDED] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{t.billing.invoicesTitle}</h2>

      {invoices.isError ? (
        <ErrorState onRetry={() => invoices.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            loading={invoices.isLoading}
            empty={
              <EmptyState
                icon={emptyIcon}
                message={t.billing.invoicesEmpty}
                description={t.billing.invoicesEmptyDesc}
              />
            }
          >
            {rows.map((inv) => (
              <tr
                key={inv.id}
                className="border-b border-[#F6F6F6] last:border-0 hover:bg-[#FAFAFA] transition cursor-pointer"
                onClick={() => setOpenId(inv.id)}
              >
                <td className="px-4 py-3 text-xs text-[#585858]">{formatDate(inv.invoiceDate)}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-[#333]">
                  {formatCurrency(inv.amount, inv.currency, 2)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={inv.status} map={statusMap} />
                </td>
              </tr>
            ))}
          </DataTable>

          {invoices.hasNextPage && (
            <div className="mt-3 text-center">
              <button
                onClick={() => invoices.fetchNextPage()}
                disabled={invoices.isFetchingNextPage}
                className="h-9 px-6 rounded-lg border border-[#EDEDED] text-[#1F114C] text-[12px] font-medium hover:bg-[#F6F6F6] transition disabled:opacity-50"
              >
                {invoices.isFetchingNextPage ? t.billing.loadingMoreInvoices : t.billing.loadMoreInvoices}
              </button>
            </div>
          )}
        </>
      )}

      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
