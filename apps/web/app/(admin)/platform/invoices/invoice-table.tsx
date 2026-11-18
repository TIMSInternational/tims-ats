'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatCurrency, formatDate } from '../../../../lib/format-utils';
import { Button, DataTable, EmptyState, Menu } from '../../../../components';
import type { MenuEntry } from '../../../../components';
import type { InvoiceListItem } from '../../../../lib/trpc-types';
import { InvoiceStatusBadge } from './invoice-status-badge';

type Row = InvoiceListItem;
type StatusAction = 'paid' | 'pending' | 'void';

interface InvoiceTableProps {
  rows: Row[];
  loading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onView: (id: string) => void;
  onBillingProfile: (organizationId: string) => void;
  onStatusAction: (id: string, action: StatusAction) => void;
  onRemind: (id: string) => void;
  remindPending: boolean;
  onCreate: () => void;
}

/** The invoices table: the number and the organization are real buttons, so keyboard users reach both. */
export function InvoiceTable({
  rows,
  loading,
  page,
  limit,
  total,
  onPageChange,
  onView,
  onBillingProfile,
  onStatusAction,
  onRemind,
  remindPending,
  onCreate,
}: InvoiceTableProps) {
  const { t } = useI18n();
  const iv = t.invoices;
  const columns = [
    { key: 'num', label: iv.colNumber },
    { key: 'org', label: iv.colOrganization },
    { key: 'amount', label: iv.colAmount, align: 'right' as const },
    { key: 'status', label: iv.colStatus },
    { key: 'issued', label: iv.colIssued },
    { key: 'due', label: iv.colDue },
    { key: 'actions', label: iv.colActions, align: 'right' as const, srOnly: true },
  ];

  const emptyIcon = (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );

  const isOverdueRow = (inv: Row) => Boolean(inv.dueDate && new Date(inv.dueDate) < new Date() && inv.status === 'pending');
  // One visible action per row, the rest in "Más acciones"; void rows are finished and show none.
  const rowActions = (inv: Row) => {
    if (inv.status === 'void') return null;
    const isPaid = inv.status === 'paid';
    const items: MenuEntry[] = [];
    if (!isPaid) items.push({ key: 'remind', label: iv.sendReminderBtn, disabled: remindPending, onSelect: () => onRemind(inv.id) });
    if (isPaid) items.push({ key: 'revert', label: iv.revertEllipsis, onSelect: () => onStatusAction(inv.id, 'pending') });
    items.push({ key: 'sep', type: 'separator' });
    items.push({ key: 'void', label: iv.voidEllipsis, destructive: true, onSelect: () => onStatusAction(inv.id, 'void') });
    return (
      <div className="flex items-center justify-end gap-1">
        {!isPaid && (
          <Button size="sm" variant="tertiary" onClick={() => onStatusAction(inv.id, 'paid')}>
            {iv.markPaidEllipsis}
          </Button>
        )}
        <Menu items={items} label={formatMessage(iv.moreActionsFor, { n: inv.invoiceNumber })} />
      </div>
    );
  };
  const invoiceButton = (inv: Row) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onView(inv.id); }}
      aria-label={formatMessage(iv.viewInvoice, { n: inv.invoiceNumber })}
      className="text-body font-semibold text-brand hover:underline pointer-coarse:min-h-11"
    >
      INV-{inv.invoiceNumber}
    </button>
  );
  const orgButton = (inv: Row) => {
    const org = inv.organization;
    if (!org?.id) return <span className="text-body text-muted">{'\u2014'}</span>;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onBillingProfile(org.id); }}
        aria-label={formatMessage(iv.billingProfileOf, { org: org.name })}
        className="inline-flex items-center gap-1 text-body font-medium text-primary hover:text-brand pointer-coarse:min-h-11"
      >
        {org.name}
        <svg className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
      </button>
    );
  };

  return (
    <DataTable
      columns={columns}
      label={iv.title}
      loading={loading}
      empty={
        <EmptyState
          icon={emptyIcon}
          message={iv.noInvoices}
          action={{ label: iv.createFirst, onClick: onCreate }}
        />
      }
      pagination={{ page, limit, total, onPageChange }}
      mobileList={rows.map((inv) => (
        <div key={inv.id} className="space-y-1.5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {invoiceButton(inv)}
            <span className={`text-body font-semibold tabular-nums ${inv.status === 'void' ? 'text-muted line-through' : 'text-primary'}`}>
              {formatCurrency(inv.amount, inv.currency, 2)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {orgButton(inv)}
            <InvoiceStatusBadge status={inv.status} dueDate={inv.dueDate} />
          </div>
          <p className={`text-callout ${isOverdueRow(inv) ? 'font-medium text-danger' : 'text-secondary'}`}>
            {formatMessage(iv.dueOn, { date: formatDate(inv.dueDate) })}
          </p>
          {rowActions(inv)}
        </div>
      ))}
    >
      {rows.map((inv) => (
        <tr
          key={inv.id}
          className="cursor-pointer border-b border-border transition-colors hover:bg-surface-hover"
          onClick={() => onView(inv.id)}
        >
          <td className="px-4 py-3">{invoiceButton(inv)}</td>
          <td className="px-4 py-3">
            {orgButton(inv)}
            {inv.lineItems?.[0]?.description && (
              <p className="max-w-52 truncate text-callout text-secondary">
                {inv.lineItems[0].description}{inv.lineItems.length > 1 ? ` (+${inv.lineItems.length - 1})` : ''}
              </p>
            )}
          </td>
          <td className="px-4 py-3 text-right">
            <span className={`text-body font-semibold tabular-nums ${inv.status === 'void' ? 'text-muted line-through' : 'text-primary'}`}>
              {formatCurrency(inv.amount, inv.currency, 2)}
            </span>
          </td>
          <td className="px-4 py-3">
            <InvoiceStatusBadge status={inv.status} dueDate={inv.dueDate} />
          </td>
          <td className="px-4 py-3">
            <span className="text-callout text-secondary">{formatDate(inv.invoiceDate || inv.createdAt)}</span>
          </td>
          <td className="px-4 py-3">
            <span className={`text-callout ${isOverdueRow(inv) ? 'font-medium text-danger' : 'text-secondary'}`}>
              {formatDate(inv.dueDate)}
            </span>
          </td>
          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>{rowActions(inv)}</td>
        </tr>
      ))}
    </DataTable>
  );
}
