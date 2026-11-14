'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { useBillingInvoices, useBillingInvoice } from '../../../../lib/platform-api/billing';
import { formatCurrency, formatDate } from '../../../../lib/format-utils';
import { Button, DataTable, Drawer, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import type { StatusMapEntry } from '../../../../components';

type T = ReturnType<typeof useI18n>['t'];

function invoiceStatusMap(t: T): Record<string, StatusMapEntry> {
  return {
    draft: { tone: 'neutral', label: t.billing.invoiceStatusDraft },
    pending: { tone: 'warning', label: t.billing.invoiceStatusPending },
    paid: { tone: 'success', label: t.billing.invoiceStatusPaid },
    void: { tone: 'danger', label: t.billing.invoiceStatusVoid },
  };
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className="text-right text-primary">{children}</dd>
    </div>
  );
}

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const invoice = useBillingInvoice(id);
  const inv = invoice.data;

  return (
    <Drawer
      title={inv ? `${t.billing.invoiceNumber} INV-${inv.invoiceNumber}` : t.billing.invoiceNumber}
      onClose={onClose}
    >
      {invoice.isError ? (
        <ErrorState onRetry={() => invoice.refetch()} />
      ) : invoice.isLoading || !inv ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-body">
          <dl className="flex flex-col gap-3">
            <DetailRow label={t.billing.invoiceColAmount}>
              <span className="font-semibold tabular-nums text-brand">
                {formatCurrency(inv.amount, inv.currency, 2)}
              </span>
            </DetailRow>
            {inv.subtotal != null && (
              <DetailRow label={t.billing.invoiceSubtotal}>
                <span className="tabular-nums">{formatCurrency(inv.subtotal, inv.currency, 2)}</span>
              </DetailRow>
            )}
            {inv.taxRate != null && (
              <DetailRow label={t.billing.invoiceTax}>
                <span className="tabular-nums">{inv.taxRate}%</span>
              </DetailRow>
            )}
            <DetailRow label={t.billing.invoiceColStatus}>
              <StatusBadge status={inv.status} map={invoiceStatusMap(t)} />
            </DetailRow>
            <DetailRow label={t.billing.invoiceColDate}>{formatDate(inv.invoiceDate)}</DetailRow>
            {inv.dueDate && <DetailRow label={t.billing.invoiceDueDate}>{formatDate(inv.dueDate)}</DetailRow>}
            {(inv.periodStart || inv.periodEnd) && (
              <DetailRow label={t.billing.invoicePeriod}>
                {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
              </DetailRow>
            )}
            {inv.poNumber && <DetailRow label={t.billing.invoicePoNumber}>{inv.poNumber}</DetailRow>}
          </dl>
          {inv.notes && (
            <div>
              <span className="mb-1 block text-secondary">{t.billing.invoiceNotes}</span>
              <p className="whitespace-pre-wrap text-primary">{inv.notes}</p>
            </div>
          )}
          {inv.invoiceUrl && (
            <Button
              variant="secondary"
              href={inv.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2"
            >
              {t.billing.invoiceDownload}
              <span className="sr-only"> {t.billing.invoiceDownloadNewTab}</span>
            </Button>
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
    <svg
      className="size-10 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  // The date is the row's real control, so Tab + Enter open the invoice (accessibility.md › Mobility).
  const openButton = (inv: (typeof rows)[number]) => {
    const date = formatDate(inv.invoiceDate);
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={formatMessage(t.billing.openInvoice, { date })}
        onClick={() => setOpenId(inv.id)}
        className="text-body font-medium text-brand underline-offset-2 hover:underline pointer-coarse:min-h-11"
      >
        {date}
      </button>
    );
  };

  const mobileList = (
    <ul className="divide-y divide-border">
      {rows.map((inv) => (
        <li
          key={inv.id}
          className={`flex items-center justify-between gap-3 px-4 py-3 ${openId === inv.id ? 'bg-brand-tint' : ''}`}
        >
          <div className="min-w-0">
            {openButton(inv)}
            <p className="text-callout font-semibold tabular-nums text-primary">
              {formatCurrency(inv.amount, inv.currency, 2)}
            </p>
          </div>
          <StatusBadge status={inv.status} map={statusMap} />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-labelledby="billing-invoices-title" className="rounded-xl border border-border bg-white p-5">
      <h2 id="billing-invoices-title" className="mb-3 text-subheading font-semibold text-primary">
        {t.billing.invoicesTitle}
      </h2>

      {invoices.isError ? (
        <ErrorState size="compact" onRetry={() => invoices.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            loading={invoices.isLoading}
            label={t.billing.invoicesTitle}
            mobileList={rows.length > 0 ? mobileList : undefined}
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
                className={`cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-surface-hover ${openId === inv.id ? 'bg-brand-tint' : ''}`}
                onClick={() => setOpenId(inv.id)}
              >
                <td className="px-4 py-3">{openButton(inv)}</td>
                <td className="px-4 py-3 text-right text-body font-semibold tabular-nums text-primary">
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
              <Button
                variant="secondary"
                onClick={() => invoices.fetchNextPage()}
                loading={invoices.isFetchingNextPage}
                loadingLabel={t.billing.loadingMoreInvoices}
              >
                {t.billing.loadMoreInvoices}
              </Button>
            </div>
          )}
        </>
      )}

      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}
